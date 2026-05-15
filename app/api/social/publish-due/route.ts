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
//   2. Pick posts where status ∈ {'draft','scheduled'} AND scheduledAt <= now.
//   3. For each due post, mark 'publishing' and persist, then iterate
//      accountIds and call publishToAccount(). Track per-account results
//      and roll up to a final status (published / partial / failed).
//   4. Persist updated collection.
//
// Concurrency: a post stuck in 'publishing' from a crashed prior run is
// re-attempted if its publishingStartedAt is older than STALE_PUBLISHING_MS.
//
// Per-run cap: MAX_POSTS_PER_RUN keeps each invocation under the function
// timeout. The 5-minute cadence means up to MAX_POSTS_PER_RUN * 12 posts/hr.

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
  results?: Record<string, { status: 'pending' | 'publishing' | 'published' | 'failed'; postId?: string | null; postUrl?: string | null; error?: string }>;
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
    if (p.status === 'draft' || p.status === 'scheduled') return true;
    if (p.status === 'publishing') {
      const startedAt = p.publishingStartedAt ? new Date(p.publishingStartedAt).getTime() : 0;
      return now - startedAt > STALE_PUBLISHING_MS;
    }
    return false;
  });

  // Process oldest first so the most overdue posts go out before fresher ones.
  duePosts.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const toProcess = duePosts.slice(0, MAX_POSTS_PER_RUN);

  if (toProcess.length === 0) {
    return NextResponse.json({ ok: true, dueCount: 0, processed: 0, skipped: 0 });
  }

  // Mark all targeted posts as 'publishing' upfront and persist. This narrows
  // (but does not eliminate) the race window with overlapping cron runs.
  const startedAtIso = new Date(now).toISOString();
  let collection = posts.map(p =>
    toProcess.find(d => d.id === p.id)
      ? { ...p, status: 'publishing' as const, publishingStartedAt: startedAtIso }
      : p
  );
  await saveCollection(DEFAULT_USER_ID, 'social_posts', collection);

  const summary: Array<{ id: string; status: string; accountResults: Array<{ accountId: string; ok: boolean; error?: string }> }> = [];

  for (const post of toProcess) {
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
        results[accountId] = { status: 'failed', error: r.error || 'Publish failed' };
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
      accountResults: Object.entries(results).map(([accountId, r]) => ({
        accountId,
        ok: r.status === 'published',
        error: r.error,
      })),
    });
  }

  return NextResponse.json({
    ok: true,
    dueCount: duePosts.length,
    processed: toProcess.length,
    skipped: Math.max(0, duePosts.length - toProcess.length),
    results: summary,
  });
}
