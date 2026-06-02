/**
 * Brain image matching — the single source of truth for "which Brain photo
 * fits this post?", shared by every place that auto-selects imagery:
 *   - lib/social-cron.ts        (Fill calendar)
 *   - app/api/social/draft      (single draft / Roam-io create_post_draft)
 *   - app/social/page.tsx       (Generate with AI modal)
 *
 * Pure + dependency-free (types only) so it can run on the server AND in the
 * browser. Keeping it here stops the three flows from drifting apart again.
 *
 * Scoring is BRIEF-LED with the post topic/theme as a tiebreak, and the Brain
 * FOLDER name counts double — it's a human-curated label (e.g. "Manchester"),
 * more reliable than the vision auto-tags.
 */

import type { Brief } from '@/lib/briefs';

/** Minimum shape an item needs to be matchable. Callers pass richer objects;
 *  the generic in pickBrainImageForContext preserves their extra fields. */
export interface ImageCandidate {
  url: string;
  tags?: string[];
  /** Curated Brain folder name, e.g. "Manchester". */
  folder?: string;
}

/** The folder name is human-curated, so a folder match outweighs a tag match. */
const FOLDER_WEIGHT = 2;

/** Lowercase, split on non-alphanumerics, drop short noise words. */
export function keywordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 3);
}

/** Count how many of an item's tags overlap (substring either way) with the
 *  given keyword list. Each tag counts at most once. */
export function tagOverlap(tags: string[], words: string[]): number {
  let score = 0;
  for (const tag of tags) {
    for (const w of words) {
      if (tag.includes(w) || w.includes(tag)) {
        score += 1;
        break; // each tag counts once
      }
    }
  }
  return score;
}

/** Derive the brief's matching vocabulary (name + audience + content brief). */
export function briefKeywords(brief?: Brief): string[] {
  if (!brief) return [];
  return keywordsOf([brief.name, brief.audience, brief.contentBrief].filter(Boolean).join(' '));
}

/**
 * Pick the Brain image most relevant to a post, BRIEF-LED with the topic as a
 * tiebreak. `topicText` is the post angle — a theme's title+prompt for Fill
 * calendar, or the user's "what's this about" topic for Generate with AI.
 *
 * - An item is eligible if it has ANY relevance (brief OR topic), so we still
 *   match when a brief's vocabulary is sparse.
 * - Folder-name overlap is weighted (FOLDER_WEIGHT) on both axes.
 * - Within the strongest (brief, topic) score tier we pick at random for
 *   variety, preferring images not yet used this run/batch.
 * - `avoidReuse`: when set, return null instead of repeating an already-used
 *   image once the unused pool is exhausted (good for a small, user-visible
 *   batch). Default false keeps Fill calendar's "always fill the slot" behaviour.
 */
export function pickBrainImageForContext<T extends ImageCandidate>(
  items: T[],
  topicText: string,
  opts?: { brief?: Brief; extraTopic?: string; excludeUrls?: Set<string>; avoidReuse?: boolean }
): T | null {
  if (items.length === 0) return null;

  const topicWords = keywordsOf([topicText, opts?.extraTopic].filter(Boolean).join(' '));
  const briefWords = briefKeywords(opts?.brief);
  if (topicWords.length === 0 && briefWords.length === 0) return null;

  type Scored = { item: T; briefScore: number; topicScore: number };
  const scored: Scored[] = items.map(item => {
    const tags = (item.tags || []).map(t => t.toLowerCase());
    const folderWords = item.folder ? keywordsOf(item.folder) : [];
    return {
      item,
      briefScore: tagOverlap(tags, briefWords) + FOLDER_WEIGHT * tagOverlap(folderWords, briefWords),
      topicScore: tagOverlap(tags, topicWords) + FOLDER_WEIGHT * tagOverlap(folderWords, topicWords),
    };
  });

  const matches = scored
    .filter(s => s.briefScore > 0 || s.topicScore > 0)
    .sort((a, b) => (b.briefScore - a.briefScore) || (b.topicScore - a.topicScore));
  if (matches.length === 0) return null;

  const excludeUrls = opts?.excludeUrls;
  const unused = matches.filter(s => !excludeUrls?.has(s.item.url));
  if (unused.length === 0 && opts?.avoidReuse) return null;
  const eligible = unused.length > 0 ? unused : matches;
  const top = eligible[0];
  const topTier = eligible.filter(s => s.briefScore === top.briefScore && s.topicScore === top.topicScore);
  return topTier[Math.floor(Math.random() * topTier.length)].item;
}
