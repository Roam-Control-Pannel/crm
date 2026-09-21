/**
 * IMAGE-COOLDOWN-V1
 *
 * "Which images have we used lately, and when?" — derived from the social
 * posts themselves rather than a separate usage ledger.
 *
 * Why derive instead of track:
 *   - The posts collection IS the record of what was used. A parallel ledger
 *     can drift from it; this cannot.
 *   - Deleting a post frees its image automatically. No cleanup job.
 *   - Fill calendar re-reads social_posts at the start of EVERY invocation
 *     (lib/social-cron.ts step 5) and saves its output at the end, so run N+1
 *     sees run N's choices for free. That single fact is what fixes the
 *     original bug: the old `usedImageUrls` Set was created empty on every
 *     invocation and a full 14-day fill takes ~21 of them, so it never
 *     excluded anything across the run.
 *   - Zero new writes on the hot path, and nothing to keep in sync.
 *
 * The cooldown is a window, not a ban. With 324 images and ~51 posts a week
 * (3 Instagram accounts at 14 slots/week plus 3 Facebook at 3), the library
 * turns over about every 44 days at best — and that assumes every image is
 * eligible for every post, which brief-led matching makes untrue. So a strict
 * never-repeat rule would starve the calendar. A 30-day window keeps real
 * headroom and degrades to least-recently-used instead of random.
 */

export interface ImageUse {
  /** Epoch ms of the most recent post scheduled with this image. */
  lastUsedAt: number;
  /** How many posts have used it, ever (within the retained history). */
  count: number;
}

/** Minimum post shape needed to derive usage. */
export interface UsageSourcePost {
  imageUrl?: string;
  scheduledAt?: string;
}

export type ImageUsageMap = Map<string, ImageUse>;

/**
 * Default cooldown window. See the arithmetic above — 30 days sits comfortably
 * inside the ~44-day theoretical ceiling for a 324-image library at the
 * current posting cadence.
 *
 * Raising this past the ceiling does not produce more variety; it just forces
 * the least-recently-used fallback to fire constantly, which is the same
 * behaviour with extra steps.
 */
export const DEFAULT_IMAGE_COOLDOWN_DAYS = 30;

/**
 * Build the usage map from a post collection.
 *
 * Counts every post that carries an imageUrl regardless of status — a
 * scheduled post has already claimed its image as far as the calendar is
 * concerned, and a published one obviously has. `scheduledAt` is the date
 * that matters (when it appears/appeared publicly), not createdAt.
 */
export function buildImageUsage(posts: UsageSourcePost[]): ImageUsageMap {
  const usage: ImageUsageMap = new Map();
  for (const post of posts) {
    const url = post.imageUrl;
    if (!url) continue;
    const at = post.scheduledAt ? new Date(post.scheduledAt).getTime() : NaN;
    const when = Number.isFinite(at) ? at : 0;
    const existing = usage.get(url);
    if (existing) {
      existing.count += 1;
      if (when > existing.lastUsedAt) existing.lastUsedAt = when;
    } else {
      usage.set(url, { lastUsedAt: when, count: 1 });
    }
  }
  return usage;
}

/**
 * Is this image inside its cooldown window relative to `slotTime`?
 *
 * Compared against the SLOT's time rather than "now" so that filling a
 * calendar two weeks out reasons about the gap the audience will actually
 * see, not the gap at the moment of generation. An image used 25 days ago is
 * in cooldown for a post going out today, but not for one going out in a
 * fortnight.
 */
export function isInCooldown(
  url: string,
  usage: ImageUsageMap,
  slotTime: number,
  cooldownDays: number
): boolean {
  const use = usage.get(url);
  if (!use) return false;
  const gapMs = Math.abs(slotTime - use.lastUsedAt);
  return gapMs < cooldownDays * 86_400_000;
}

/**
 * Ordering for the least-recently-used fallback: oldest last-use first, and
 * among equals the one used fewest times. Used only when every candidate is
 * in cooldown — better a 29-day-old photo than a 2-day-old one.
 */
export function byLeastRecentlyUsed(
  a: string,
  b: string,
  usage: ImageUsageMap
): number {
  const ua = usage.get(a);
  const ub = usage.get(b);
  // Never-used sorts first.
  if (!ua && !ub) return 0;
  if (!ua) return -1;
  if (!ub) return 1;
  return ua.lastUsedAt - ub.lastUsedAt || ua.count - ub.count;
}
