import { NextRequest, NextResponse } from 'next/server';
import { getCollection, saveCollection, DEFAULT_USER_ID } from '@/lib/store';
import { publishToAccount, PublishPlatform, parseAccountId, MAX_POST_MS } from '@/lib/social-publish';
import { buildUnsplashCredit } from '@/lib/unsplash-credit';
import { safeEqual } from '@/lib/safe-equal';

/**
 * Derive the publishing platform from an account ID prefix.
 *   'li-personal:...' or 'li-company:...' -> 'linkedin'
 *   'meta-page:...'                       -> 'facebook'
 *   'meta-ig:...'                         -> 'instagram'
 * Returns null for unknown prefixes so the caller can record a per-account
 * failure rather than throwing.
 */
function platformFromAccountId(accountId: string): PublishPlatform | null {
  const { kind } = parseAccountId(accountId);
  if (kind === 'li-personal' || kind === 'li-company') return 'linkedin';
  if (kind === 'meta-page') return 'facebook';
  if (kind === 'meta-ig') return 'instagram';
  return null;
}

// CRON-PUBLISH-V1
// Auto-publish social posts whose scheduledAt has arrived.
//
// Auth: requires x-internal-call header with CRON_SECRET_V2 (same pattern
// as /api/social/auto-generate). The Netlify scheduled function injects
// this server-side; browsers can't call it directly.
//
// Behaviour:
//   1. Load social_posts.
//   2. Pick posts where status === 'scheduled' AND scheduledAt <= now.
//      Drafts are excluded by design — a post must be explicitly scheduled
//      (status === 'scheduled' with a scheduledAt time) to auto-publish.
//      The "Publish now" button in the UI bypasses this entirely by
//      calling /api/social/publish directly, so it works on any post
//      regardless of status.
//   3. For each due post, mark 'publishing' and persist, then iterate
//      accountIds and call publishToAccount(). Track per-account results
//      and roll up to a final status (published / partial / failed).
//   4. Persist updated collection.
//
// Concurrency: a post stuck in 'publishing' from a crashed prior run is
// re-attempted if its publishingStartedAt is older than STALE_PUBLISHING_MS.
//
// Per-run cap: MAX_POSTS_PER_RUN keeps each invocation under the function
// timeout. The cadence is every 2 minutes (netlify.toml + the inline config
// in netlify/functions/social-publish-due.mts — every-minute was tried and
// Netlify silently declined to register it), so the ceiling is
// MAX_POSTS_PER_RUN * 30 posts/hr. In practice the measured-cost gate in
// PUBLISH-DUE-BUDGET-V2 stops the run well before the cap on slow posts.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// maxDuration is the Next/Netlify function ceiling. FUNCTION_BUDGET_MS below
// is the figure we actually plan against: Netlify hard-kills a standard
// function at ~26s regardless of what maxDuration claims, so the budget is
// deliberately the smaller of the two, not this number.
export const maxDuration = 60;

const MAX_POSTS_PER_RUN = 20;
const STALE_PUBLISHING_MS = 15 * 60 * 1000; // 15 min

interface SocialPostStored {
  id: string;
  briefId?: string;
  accountIds: string[];
  caption: string;
  imageUrl?: string;
  imageCredit?: string;
  imageCreditUrl?: string;
  imageUnsplashUrl?: string;
  imagePhotoUrl?: string;
  imageSocialHandles?: { instagram?: string | null; twitter?: string | null; unsplash?: string | null };
  scheduledAt: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';
  results?: Record<string, { status: 'pending' | 'publishing' | 'published' | 'failed'; postId?: string | null; postUrl?: string | null; error?: string; details?: unknown }>;
  publishingStartedAt?: string;
  publishedAt?: string;
  createdAt: string;
}

/**
 * PUBLISH-PARTIAL-PERSIST-V1
 *
 * Write one post's per-account results back, merging into a FRESH read
 * rather than into the snapshot this run started from.
 *
 * Two things this buys us:
 *   - partial progress survives a mid-run kill, so a re-attempt 15 minutes
 *     later skips the accounts that already went live instead of posting
 *     the same caption again;
 *   - the write no longer rewrites the whole collection from a pre-network
 *     snapshot, so a post created or edited elsewhere during the seconds we
 *     spent talking to LinkedIn/Meta is not reverted.
 *
 * Passing `finalStatus` closes the post out (clears publishingStartedAt and
 * stamps publishedAt); omitting it leaves the post in 'publishing' so the
 * stale-recovery path still owns it.
 */
async function persistResults(
  postId: string,
  results: SocialPostStored['results'],
  finalStatus?: SocialPostStored['status']
): Promise<SocialPostStored[]> {
  const fresh = (await getCollection<SocialPostStored[]>(DEFAULT_USER_ID, 'social_posts')) || [];
  const next = fresh.map(p =>
    p.id === postId
      ? {
          ...p,
          results,
          ...(finalStatus
            ? {
                status: finalStatus,
                publishingStartedAt: undefined,
                publishedAt: new Date().toISOString(),
              }
            : {}),
        }
      : p
  );
  await saveCollection(DEFAULT_USER_ID, 'social_posts', next);
  return next;
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET_V2 not configured' }, { status: 500 });
  }
  const provided = req.headers.get('x-internal-call');
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const posts = (await getCollection<SocialPostStored[]>(DEFAULT_USER_ID, 'social_posts')) || [];

  const duePosts = posts.filter(p => {
    const due = new Date(p.scheduledAt).getTime() <= now;
    if (!due) return false;
    // Only posts the user has explicitly scheduled fire on the cron.
    // Drafts stay drafts until the user either schedules them or hits
    // "Publish now" (which routes through /api/social/publish and
    // overrides any status check).
    if (p.status === 'scheduled') return true;
    // Re-attempt posts stuck in 'publishing' past the stale threshold
    // — likely a prior cron run crashed mid-publish. Only do this for
    // posts that were originally 'scheduled' (publishingStartedAt is
    // only set by this cron, not by ad-hoc UI publishes).
    if (p.status === 'publishing') {
      const startedAt = p.publishingStartedAt ? new Date(p.publishingStartedAt).getTime() : 0;
      return startedAt > 0 && now - startedAt > STALE_PUBLISHING_MS;
    }
    return false;
  });

  // Process oldest first so the most overdue posts go out before fresher ones.
  duePosts.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  if (duePosts.length === 0) {
    return NextResponse.json({ ok: true, dueCount: 0, processed: 0, skipped: 0 });
  }

  // PUBLISH-DUE-BUDGET-V1
  // Netlify kills a standard function at ~26s (the same limit the Fill-calendar
  // route budgets against). Publishing is slow — an Instagram post polls its
  // media container for several seconds before it can publish — so the old
  // "mark every due post 'publishing' upfront, then loop" strategy blew the
  // budget on a busy day: the function was killed mid-run, EVERY targeted post
  // was stranded in 'publishing', and nothing recovered for STALE_PUBLISHING_MS
  // (15 min) — at which point it timed out again. The symptom was scheduled
  // posts that never published and a 🐛 run that returned a gateway timeout.
  //
  // Instead we now:
  //   - mark each post 'publishing' individually, right before processing it,
  //     so a timeout strands only the single in-flight post (recoverable via
  //     the stale-publishing path); posts we haven't started stay 'scheduled'
  //     and the next cron run picks them up;
  //   - stop starting NEW posts once we're close enough to the limit that the
  //     next one might not finish in time.
  const FUNCTION_BUDGET_MS = 26000; // Netlify standard-function hard limit
  const SAFETY_MS = 3000;           // headroom for persistence + teardown
  // MAX_POST_MS is imported from lib/social-publish, which now actually
  // enforces it via AbortSignal on every call (PUBLISH-DEADLINE-V1). It used
  // to be a local constant that nothing honoured, which made all the
  // arithmetic below wishful thinking.
  const startTime = Date.now();

  let collection: SocialPostStored[] = posts.slice();

  // PUBLISH-DUE-DETAILS-V1: summary type widened to carry imageUrl and
  // per-account details for diagnostics.
  const summary: Array<{
    id: string;
    status: string;
    imageUrl?: string;
    accountResults: Array<{ accountId: string; ok: boolean; error?: string; details?: unknown }>;
  }> = [];

  let processed = 0;
  let stoppedEarly = false;

  for (const post of duePosts) {
    // Hard cap regardless of timing.
    if (processed >= MAX_POSTS_PER_RUN) { stoppedEarly = true; break; }
    // PUBLISH-DUE-BUDGET-V2
    // Gate on MEASURED cost, not the fixed worst case. The old test reserved
    // a full MAX_POST_MS for the next post, so after the first post the loop
    // broke as soon as 26000-3000-15000 = 8s had elapsed — and since a real
    // post usually takes longer than 8s, MAX_POSTS_PER_RUN = 20 could never
    // be reached. The practical ceiling was one post per run, so a backlog
    // after a scheduler outage drained at roughly one post every two minutes.
    //
    // Most posts target a single account and finish in a couple of seconds,
    // so the running average is a far better predictor than the three-account
    // worst case. The floor keeps us honest on the first estimate, and the
    // per-post deadline below means a bad guess costs a clean timeout on one
    // post rather than a killed function.
    const elapsed = Date.now() - startTime;
    const avgPostMs = processed > 0 ? Math.max(elapsed / processed, 1500) : 0;
    if (processed > 0 && elapsed + avgPostMs > FUNCTION_BUDGET_MS - SAFETY_MS) {
      stoppedEarly = true;
      break;
    }

    // CLAIM-V1
    // Re-read the freshest collection right before claiming this post. With the
    // in-app client trigger plus the Netlify and GitHub cron paths, multiple
    // invocations can run concurrently; without a claim they could each read the
    // same 'scheduled' post from their initial snapshot and double-publish it.
    // The blob store uses strong consistency, so re-reading here sees a competing
    // run's 'publishing' write and lets us bail. Whoever writes 'publishing'
    // first wins; the others skip. This shrinks the race to the sub-millisecond
    // window between this read and the save below.
    const startedAtIso = new Date().toISOString();
    const fresh = (await getCollection<SocialPostStored[]>(DEFAULT_USER_ID, 'social_posts')) || [];
    const live = fresh.find(p => p.id === post.id);
    if (!live) continue;
    const claimable =
      live.status === 'scheduled' ||
      (live.status === 'publishing' &&
        !!live.publishingStartedAt &&
        now - new Date(live.publishingStartedAt).getTime() > STALE_PUBLISHING_MS);
    if (!claimable) {
      // Another concurrent run already claimed or finished this post.
      continue;
    }

    // Mark THIS post 'publishing' and persist before any network work, so a
    // mid-run timeout leaves only this one post recoverable and never strands
    // posts we haven't reached yet.
    collection = fresh.map(p =>
      p.id === post.id
        ? { ...p, status: 'publishing' as const, publishingStartedAt: startedAtIso }
        : p
    );
    await saveCollection(DEFAULT_USER_ID, 'social_posts', collection);

    // PUBLISH-PARTIAL-PERSIST-V1
    // Seed from whatever a previous (killed) attempt already managed to
    // record. Without this, a stale re-attempt started from an empty
    // results object and re-ran every account from scratch — so a run that
    // died after LinkedIn and Facebook succeeded but during Instagram's
    // container wait posted the same caption to LinkedIn and Facebook a
    // second time 15 minutes later, and again every 15 minutes after that.
    const results: SocialPostStored['results'] = {};
    for (const accountId of post.accountIds) {
      const prior = live.results?.[accountId];
      results[accountId] =
        prior?.status === 'published'
          ? prior
          : { status: 'pending' };
    }

    // PUBLISH-DEADLINE-V1: ONE deadline for the whole post, shared by every
    // account, so MAX_POST_MS means what its name says and the reservation
    // arithmetic above is honest. Clamped so we can never run past the
    // function budget however many accounts the post targets.
    const postDeadline = Math.min(
      Date.now() + MAX_POST_MS,
      startTime + FUNCTION_BUDGET_MS - SAFETY_MS
    );

    // Deterministic order: linkedin -> facebook -> instagram. Mirrors the
    // ordering used by the client-side publishPost() so manual and auto
    // publishes produce the same per-account sequence.
    const orderRank: Record<string, number> = { linkedin: 0, facebook: 1, instagram: 2 };
    const sorted = [...post.accountIds].sort((a, b) => {
      const pA = platformFromAccountId(a) || '';
      const pB = platformFromAccountId(b) || '';
      return (orderRank[pA] ?? 9) - (orderRank[pB] ?? 9);
    });

    for (const accountId of sorted) {
      // PUBLISH-PARTIAL-PERSIST-V1: never re-post to an account a previous
      // attempt already got onto the platform. publishToAccount has no
      // idempotency key, so this persisted status is the only thing standing
      // between a killed run and a duplicate live post.
      if (results[accountId]?.status === 'published') {
        continue;
      }

      const platform = platformFromAccountId(accountId);
      if (!platform) {
        results[accountId] = { status: 'failed', error: `Unknown account id prefix: ${accountId}` };
        await persistResults(post.id, results);
        continue;
      }
      const captionWithCredit = post.caption + buildUnsplashCredit(post, platform);
      const r = await publishToAccount({
        accountId,
        platform,
        caption: captionWithCredit,
        imageUrl: post.imageUrl,
        deadline: postDeadline,
      });
      if (r.ok) {
        results[accountId] = { status: 'published', postId: r.postId ?? undefined, postUrl: r.postUrl ?? undefined };
      } else {
        // PUBLISH-DUE-DETAILS-V1
        // Stash the upstream details object alongside the bare error
        // message so the social UI (and the 🐛 debug button) can show
        // the full Meta error including subcode, error_user_msg, and
        // fbtrace_id. SocialPostStored.results doesn't declare a
        // `details` field, but storing it as an extra key is forward-
        // compatible — clients that don't know about it will ignore it.
        results[accountId] = { status: 'failed', error: r.error || 'Publish failed', details: r.details } as any;
      }

      // PUBLISH-PARTIAL-PERSIST-V1: write the outcome of THIS account before
      // starting the next one. The post stays 'publishing' so the stale path
      // still recovers it, but the per-account record is now durable.
      collection = await persistResults(post.id, results);
    }

    const allResults = Object.values(results);
    const allPublished = allResults.every(r => r.status === 'published');
    const anyPublished = allResults.some(r => r.status === 'published');
    const finalStatus: SocialPostStored['status'] = allPublished ? 'published' : anyPublished ? 'partial' : 'failed';

    collection = await persistResults(post.id, results, finalStatus);

    summary.push({
      id: post.id,
      status: finalStatus,
      // PUBLISH-DUE-DETAILS-V1: surface enough context to diagnose
      // failures without needing function logs. imageUrl is the exact
      // URL the route handed to publishToAccount(); details is whatever
      // the platform handler returned alongside the failure (for Meta,
      // the full error object including error_user_msg and subcode).
      imageUrl: post.imageUrl,
      accountResults: Object.entries(results).map(([accountId, r]) => ({
        accountId,
        ok: r.status === 'published',
        error: r.error,
        details: (r as any).details,
      })),
    });
    processed++;
  }

  return NextResponse.json({
    ok: true,
    dueCount: duePosts.length,
    processed,
    skipped: Math.max(0, duePosts.length - processed),
    stoppedEarly,
    results: summary,
  });
}
