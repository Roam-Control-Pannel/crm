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
 * IMAGE-RANK-V2 — scoring is THEME-LED, with the brief as a tiebreak.
 *
 * It used to be the other way round, and that was the real cause of "the same
 * images keep coming back". The sort was lexicographic:
 *
 *     (b.briefScore - a.briefScore) || (b.topicScore - a.topicScore)
 *
 * The brief is CONSTANT for a whole Fill calendar run; the theme is the only
 * thing that varies per post. Sorting on the constant first means the theme
 * can never overcome a brief lead, so whichever handful of photos happen to
 * carry a brief-vocabulary tag win every slot. Measured against the repo's own
 * 25 seed themes and 3 default briefs: ONE photo was chosen for all 18 Roam
 * Local themes, and one for all 18 Roam NI themes. A photo scoring brief=1
 * topic=0 beat one scoring brief=0 topic=2.
 *
 * Phase A's cooldown then rotated within that tiny dominant set rather than
 * across the library — it treated the symptom. This is the cause.
 *
 * Three changes:
 *   1. Theme-led. One topical hit outranks any amount of brief relevance;
 *      the brief separates photos the theme scored equally.
 *   2. The DESCRIPTION is scored. It was ignored entirely.
 *   3. Stemmed token matching instead of substring containment, so a tag
 *      "pub" stops matching "published". See lib/text-match.ts.
 */

import type { Brief } from '@/lib/briefs';
import {
  type ImageUsageMap,
  isInCooldown,
  byLeastRecentlyUsed,
} from '@/lib/image-usage';
import { tokenSet, overlapCount } from '@/lib/text-match';


/** Minimum shape an item needs to be matchable. Callers pass richer objects;
 *  the generic in pickBrainImageForContext preserves their extra fields. */
export interface ImageCandidate {
  url: string;
  tags?: string[];
  /** Curated Brain folder name, e.g. "Manchester". */
  folder?: string;
  /**
   * The vision model's one-sentence description of the photo, written at
   * upload time by /api/brain/items.
   *
   * IMAGE-RANK-V2: this was not scored at all. It is the richest thing the
   * Brain knows about a photo — the matcher looked only at 3-6 kebab-case
   * tags and the folder name and ignored the sentence describing the actual
   * picture. A photo whose description reads "Fishing boats moored in the
   * harbour at sunrise" scored ZERO against a coastal theme unless a tag
   * happened to share a substring.
   */
  description?: string;
}

/**
 * IMAGE-RANK-V2 — field weights.
 *
 * Per-hit, not per-field-total, so an item cannot win by having more tags.
 *
 *   folder (3) is a human-curated label — someone filed this photo under
 *     "Bangor" on purpose, which beats anything inferred.
 *   tags (2) are the vision model's distilled labels: fewer, chosen.
 *   description (1) is prose. It has many more tokens and therefore many
 *     more chances to hit, including incidental ones ("busy", "afternoon"),
 *     so each hit is worth less.
 */
const W_FOLDER = 3;
const W_TAGS = 2;
const W_DESCRIPTION = 1;

/**
 * Multiplier that makes the brief a TIEBREAK rather than a precedence.
 * Larger than any achievable brief score, so brief relevance can only ever
 * separate photos the theme scored equally. See the header note on
 * IMAGE-RANK-V2 for why this had to change.
 */
const TOPIC_SCALE = 1000;

interface ItemTokens {
  folder: Set<string>;
  tags: Set<string>;
  description: Set<string>;
}

function tokensFor(item: ImageCandidate): ItemTokens {
  return {
    folder: tokenSet(item.folder || ''),
    tags: tokenSet((item.tags || []).join(' ')),
    description: tokenSet(item.description || ''),
  };
}

/** Weighted overlap of one item against one query token set. */
function scoreAgainst(tokens: ItemTokens, query: Set<string>): number {
  if (query.size === 0) return 0;
  return (
    W_FOLDER * overlapCount(tokens.folder, query) +
    W_TAGS * overlapCount(tokens.tags, query) +
    W_DESCRIPTION * overlapCount(tokens.description, query)
  );
}

/** Derive the brief's matching vocabulary (name + audience + content brief). */
export function briefTokens(brief?: Brief): Set<string> {
  if (!brief) return new Set();
  return tokenSet([brief.name, brief.audience, brief.contentBrief].filter(Boolean).join(' '));
}

/**
 * Topic score given to the best semantically-shortlisted photo. High enough
 * that anything on the shortlist outranks anything scored only lexically,
 * and large enough to hold a shortlist of any realistic length.
 */
const SEMANTIC_BASE = 10_000;

export function pickBrainImageForContext<T extends ImageCandidate>(
  items: T[],
  topicText: string,
  opts?: {
    brief?: Brief;
    extraTopic?: string;
    excludeUrls?: Set<string>;
    avoidReuse?: boolean;
    /** Usage history derived from existing posts. */
    usage?: ImageUsageMap;
    /** Epoch ms of the slot being filled — cooldown is measured against this. */
    slotTime?: number;
    cooldownDays?: number;
    /**
     * IMAGE-RANK-V2: an ordering supplied by the semantic shortlist
     * (lib/image-shortlist.ts) — url -> rank, 0 = best. When present it
     * replaces the lexical topic score, because a model that has read the
     * descriptions beats token overlap. The brief tiebreak, the cooldown
     * window and the least-recently-used fallback all still apply on top,
     * so the deterministic half of the picker is unchanged.
     */
    semanticRank?: Map<string, number>;
  }
): T | null {
  if (items.length === 0) return null;

  const topicQuery = tokenSet([topicText, opts?.extraTopic].filter(Boolean).join(' '));
  const briefQuery = briefTokens(opts?.brief);
  const semanticRank = opts?.semanticRank;
  if (topicQuery.size === 0 && briefQuery.size === 0 && !semanticRank) return null;

  type Scored = { item: T; topicScore: number; briefScore: number; relevance: number };
  const scored: Scored[] = items.map(item => {
    const tokens = tokensFor(item);
    // A shortlisted photo's topic score is its position, inverted so that
    // rank 0 scores highest. Anything the model left off the list keeps its
    // lexical score, which is how a shortlist that covers only part of the
    // library degrades instead of discarding the rest.
    const rank = semanticRank?.get(item.url);
    const topicScore =
      rank === undefined
        ? scoreAgainst(tokens, topicQuery)
        : SEMANTIC_BASE - rank;
    const briefScore = scoreAgainst(tokens, briefQuery);
    return { item, topicScore, briefScore, relevance: topicScore * TOPIC_SCALE + briefScore };
  });

  const matches = scored
    .filter(s => s.topicScore > 0 || s.briefScore > 0)
    .sort((a, b) => b.relevance - a.relevance);
  if (matches.length === 0) return null;

  const excludeUrls = opts?.excludeUrls;
  // Already placed earlier in THIS run — always a hard exclusion.
  const unused = matches.filter(s => !excludeUrls?.has(s.item.url));
  if (unused.length === 0 && opts?.avoidReuse) return null;
  let eligible = unused.length > 0 ? unused : matches;

  // IMAGE-COOLDOWN-V1: drop anything used too recently relative to this slot.
  const usage = opts?.usage;
  const cooldownDays = opts?.cooldownDays ?? 0;
  if (usage && cooldownDays > 0) {
    const slotTime = opts?.slotTime ?? Date.now();
    const fresh = eligible.filter(s => !isInCooldown(s.item.url, usage, slotTime, cooldownDays));
    if (fresh.length > 0) {
      eligible = fresh;
    } else if (opts?.avoidReuse) {
      return null;
    }
    // else: every candidate is in cooldown — keep `eligible` as-is and let the
    // least-recently-used ordering below pick the stalest one. Failing the
    // slot outright would leave a hole in the calendar for no benefit.
  }

  const top = eligible[0];
  const topTier = eligible.filter(s => s.relevance === top.relevance);
  if (topTier.length === 1 || !usage) {
    // No history to reason about — keep the original random tiebreak so
    // behaviour is unchanged for callers that don't pass usage.
    return topTier[Math.floor(Math.random() * topTier.length)].item;
  }
  // Least-recently-used within the tier.
  const ordered = [...topTier].sort((a, b) =>
    byLeastRecentlyUsed(a.item.url, b.item.url, usage)
  );
  return ordered[0].item;
}
