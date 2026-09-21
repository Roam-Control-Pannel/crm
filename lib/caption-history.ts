/**
 * CAPTION-VARIETY-V1
 *
 * "What have we already said on this account lately?" — derived from the
 * social posts themselves, exactly as IMAGE-COOLDOWN-V1 derives image usage.
 * Same reasoning: the posts collection IS the record, a parallel ledger can
 * drift from it, and Fill calendar re-reads social_posts at the start of
 * every invocation, so run N+1 sees run N for free.
 *
 * The problem this fixes
 * ----------------------
 * generateCaption's only anti-repetition device was one sentence in the user
 * message: "Make it distinct from the other posts in this series — vary the
 * hook, angle, structure, and any examples." The model was never shown those
 * other posts. It was being asked to avoid repeating text it could not see,
 * across ~84 independent API calls that shared a near-identical prompt. The
 * predictable result is the same handful of openings over and over.
 *
 * What gets sent
 * --------------
 * Two tiers, because the two kinds of repetition have very different costs
 * to fix:
 *
 *   1. OPENING LINES (many, cheap). The first line is the single most
 *      visible repeat — a feed of posts all starting "Ever wondered..." is
 *      obvious at a glance. One line each is ~15 tokens, so 20 of them cost
 *      almost nothing and cover about three weeks of an Instagram account.
 *   2. FULL RECENT POSTS (few, dearer). Truncated bodies so the model can
 *      also see structure, examples and sign-offs it should vary. Six is
 *      enough to establish the pattern without dominating the prompt.
 *
 * Scoped per ACCOUNT, not per brief: the audience sees one feed, and a
 * repeated hook reads as repetition whichever content track produced it.
 */

export interface CaptionSourcePost {
  caption?: string;
  accountIds?: string[];
  scheduledAt?: string;
}

/** How many previous posts to quote in full (truncated) form. */
export const RECENT_POST_LIMIT = 6;

/** How many opening lines to list. */
export const RECENT_HOOK_LIMIT = 20;

/**
 * Characters of each quoted post to include. A LinkedIn post at the top of
 * its 150-300 word range is ~1,900 characters, so this keeps the hook, the
 * body's shape and usually the close, while capping eight quotes at roughly
 * 1,200 tokens.
 */
export const CAPTION_EXCERPT_CHARS = 600;

/** Characters of an opening line to list. Long enough to identify a hook. */
export const HOOK_CHARS = 120;

export interface CaptionHistory {
  /** Truncated bodies of the nearest previous posts, nearest first. */
  recent: string[];
  /** Opening lines of a wider set of previous posts, nearest first. */
  hooks: string[];
}

export const EMPTY_CAPTION_HISTORY: CaptionHistory = { recent: [], hooks: [] };

function firstLineOf(caption: string): string {
  // Captions are written with deliberate line breaks, so the first non-empty
  // line is the hook. Fall back to the first sentence for single-block copy.
  const line = caption.split('\n').map(s => s.trim()).find(Boolean) || '';
  if (line.length <= HOOK_CHARS) return line;
  return line.slice(0, HOOK_CHARS).trimEnd() + '...';
}

function excerptOf(caption: string): string {
  const text = caption.trim();
  if (text.length <= CAPTION_EXCERPT_CHARS) return text;
  return text.slice(0, CAPTION_EXCERPT_CHARS).trimEnd() + '...';
}

/**
 * Build the history for one slot.
 *
 * Ordered by distance from `slotTime` rather than by absolute recency,
 * because a calendar fill writes two weeks into the future: when scheduling
 * a post for the 30th, the posts that matter are the ones on either side of
 * the 30th, not the ones published last week. Same reasoning as
 * isInCooldown comparing against the slot rather than "now".
 *
 * Posts with no caption, or not on this account, are skipped. Duplicate
 * captions collapse to one entry so a repeat already in the calendar doesn't
 * crowd out five distinct examples.
 */
export function buildCaptionHistory(
  posts: CaptionSourcePost[],
  accountId: string,
  slotTime: number
): CaptionHistory {
  const candidates: Array<{ caption: string; distance: number }> = [];
  for (const post of posts) {
    const caption = (post.caption || '').trim();
    if (!caption) continue;
    if (!post.accountIds || !post.accountIds.includes(accountId)) continue;
    const at = post.scheduledAt ? new Date(post.scheduledAt).getTime() : NaN;
    // A post with no usable date is still evidence of what we've said; sort
    // it last rather than dropping it.
    const distance = Number.isFinite(at)
      ? Math.abs(slotTime - at)
      : Number.MAX_SAFE_INTEGER;
    candidates.push({ caption, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);

  const seen = new Set<string>();
  const recent: string[] = [];
  const hooks: string[] = [];
  const seenHooks = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.caption)) continue;
    seen.add(c.caption);
    if (recent.length < RECENT_POST_LIMIT) recent.push(excerptOf(c.caption));
    const hook = firstLineOf(c.caption);
    // Compare hooks case-insensitively so "Ever wondered" and "ever wondered"
    // don't both take a slot in a list whose whole job is spotting sameness.
    const hookKey = hook.toLowerCase();
    if (hook && !seenHooks.has(hookKey) && hooks.length < RECENT_HOOK_LIMIT) {
      seenHooks.add(hookKey);
      hooks.push(hook);
    }
    if (recent.length >= RECENT_POST_LIMIT && hooks.length >= RECENT_HOOK_LIMIT) break;
  }
  return { recent, hooks };
}

/**
 * Render the history as prompt lines. Returns [] when there is no history,
 * so a first-ever post doesn't carry an empty "avoid these" section that
 * only invites the model to wonder what it's missing.
 */
export function captionHistoryLines(history: CaptionHistory): string[] {
  if (history.recent.length === 0 && history.hooks.length === 0) return [];
  const lines: string[] = ['', 'ALREADY PUBLISHED ON THIS ACCOUNT — DO NOT REPEAT:'];
  if (history.hooks.length > 0) {
    lines.push(
      '',
      'Opening lines already used. Your first line must not match any of these, ' +
        'and must not be a reworded version of one:'
    );
    for (const hook of history.hooks) lines.push('- ' + hook);
  }
  if (history.recent.length > 0) {
    lines.push(
      '',
      'Nearby posts in full (truncated). Vary the structure, the examples, the ' +
        'rhetorical devices and the sign-off from these — do not restate their points:'
    );
    history.recent.forEach((text, i) => {
      lines.push('', `--- previous post ${i + 1} ---`, text);
    });
    lines.push('--- end of previous posts ---');
  }
  return lines;
}
