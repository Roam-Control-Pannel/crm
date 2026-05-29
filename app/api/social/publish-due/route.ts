import { NextRequest, NextResponse } from 'next/server';
import { getCollection, saveCollection, DEFAULT_USER_ID } from '@/lib/store';
import { publishToAccount, PublishPlatform, parseAccountId } from '@/lib/social-publish';
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
// timeout. The 1-minute cadence means up to MAX_POSTS_PER_RUN * 60 posts/hr.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
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
  const MAX_POST_MS = 15000;        // worst-case single post (IG container wait + API calls)
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
    // Time budget: always process the first post (it fits comfortably), but
    // only start a subsequent one if it can plausibly finish before the kill.
    // Whatever we don't start stays 'scheduled' for the next run.
    if (processed > 0 && Date.now() - startTime > FUNCTION_BUDGET_MS - SAFETY_MS - MAX_POST_MS) {
      stoppedEarly = true;
      break;
    }

    // Mark THIS post 'publishing' and persist before any network work, so a
    // mid-run timeout leaves only this one post recoverable and never strands
    // posts we haven't reached yet.
    const startedAtIso = new Date().toISOString();
    collection = collection.map(p =>
      p.id === post.id
        ? { ...p, status: 'publishing' as const, publishingStartedAt: startedAtIso }
        : p
    );
    await saveCollection(DEFAULT_USER_ID, 'social_posts', collection);
    const results: SocialPostStored['results'] = {};
    for (const accountId of post.accountIds) {
      results[accountId] = { status: 'pending' };
    }

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
      const platform = platformFromAccountId(accountId);
      if (!platform) {
        results[accountId] = { status: 'failed', error: `Unknown account id prefix: ${accountId}` };
        continue;
      }
      const captionWithCredit = post.caption + buildUnsplashCredit(post, platform);
      const r = await publishToAccount({
        accountId,
        platform,
        caption: captionWithCredit,
        imageUrl: post.imageUrl,
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
    }

    const allResults = Object.values(results);
    const allPublished = allResults.every(r => r.status === 'published');
    const anyPublished = allResults.some(r => r.status === 'published');
    const finalStatus: SocialPostStored['status'] = allPublished ? 'published' : anyPublished ? 'partial' : 'failed';

    collection = collection.map(p =>
      p.id === post.id
        ? { ...p, status: finalStatus, results, publishingStartedAt: undefined, publishedAt: new Date().toISOString() }
        : p
    );
    // Persist after each post so a mid-run crash doesn't lose progress on
    // earlier posts.
    await saveCollection(DEFAULT_USER_ID, 'social_posts', collection);

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
