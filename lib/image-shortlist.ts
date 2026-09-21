/**
 * IMAGE-SEMANTIC-V1
 *
 * A semantic shortlist of Brain photos for one theme, produced by asking a
 * model to read the photo descriptions rather than by counting shared words.
 *
 * Why this exists
 * ---------------
 * IMAGE-RANK-V2 fixed the ranking bug in lib/brain-image-match.ts (the brief
 * outranked the theme, so one photo won every slot) and started scoring the
 * description. Measured on the repo's 25 seed themes, that took distinct
 * choices from 1-of-10 to 5-of-10. The remaining concentration is the ceiling
 * of token overlap, and it is a hard ceiling: this theme bank is written in
 * abstractions — "The wrong turn", "Map gaps", "What locals know", "The
 * 90-second decision" — which share essentially no vocabulary with a sentence
 * like "A row of independent shops on a Belfast side street", however good
 * the stemming is. No lexical scheme bridges that. Reading does.
 *
 * Shape of the call
 * -----------------
 * ONE request per (theme, brief) per run, not one per slot. Themes repeat
 * across a 14-day fill, so a ~25-theme run costs ~25 requests however many
 * posts it writes, and the result is a ranked list the deterministic layer
 * then walks — the model proposes an order, cooldown and least-recently-used
 * still decide which of those photos this particular slot gets. Semantics
 * where semantics are needed; determinism where determinism is needed.
 *
 * The photo catalogue is identical for every theme in a run, so it goes in a
 * cached system prefix and the theme goes in the user turn. Unlike the
 * caption prompt in Phase B — where the stable half was a few hundred tokens
 * and honestly below the cache minimum — a 324-photo catalogue is roughly
 * 8,000 tokens, comfortably over Sonnet 5's 1,024-token floor. This is the
 * place in the app where prompt caching actually pays.
 *
 * Failure is always survivable: every error, timeout or unparseable answer
 * returns null, and the caller falls back to the lexical ranking, which is
 * the behaviour it had before this module existed.
 */

/** Minimum item shape the shortlist needs. */
export interface ShortlistCandidate {
  url: string;
  description?: string;
  tags?: string[];
  folder?: string;
}

/** url -> rank, 0 = best. Consumed by pickBrainImageForContext's semanticRank. */
export type SemanticRank = Map<string, number>;

/**
 * How many photos to ask for. Large enough that a whole fill can draw from
 * one shortlist without exhausting it (a 14-day fill places ~84 posts across
 * ~25 themes, so ~4 slots per theme), and small enough that the model is
 * making a real judgement rather than re-ordering the library.
 */
export const SHORTLIST_SIZE = 12;

/**
 * Cap on catalogue size. Beyond this the lexical scorer pre-filters, because
 * the point of the call is judgement over a plausible set, not paging through
 * thousands of rows — and because the prompt has to stay affordable.
 */
export const MAX_CATALOGUE = 400;

/** One catalogue line. Index is the model's handle for the photo. */
function catalogueLine(item: ShortlistCandidate, index: number): string {
  const parts = [`${index}.`];
  if (item.folder) parts.push(`[${item.folder}]`);
  parts.push(item.description || '(no description)');
  if (item.tags && item.tags.length) parts.push(`(${item.tags.join(', ')})`);
  return parts.join(' ');
}

/**
 * The stable half of the prompt: the instruction and the photo catalogue.
 * Identical for every theme in a run, which is what makes it cacheable.
 */
export function buildCatalogue(items: ShortlistCandidate[]): string {
  return [
    'You are choosing photographs for a social media post from a library the',
    'brand owns. You will be given the library once, then asked about a',
    'specific post theme.',
    '',
    'Judge fit by what is actually IN the photo against what the post is about.',
    'A literal keyword match is not the goal — a theme about taking a wrong turn',
    'and discovering somewhere is well served by a quiet side street or an',
    'unmarked doorway, and badly served by a wide landscape, even though neither',
    'shares a word with it. Prefer photos with a clear subject a caption can',
    'point at. Never invent a photo that is not listed.',
    '',
    'THE LIBRARY:',
    ...items.map(catalogueLine),
  ].join('\n');
}

/** The per-theme half. */
export function buildThemeQuestion(
  themeText: string,
  briefName: string | undefined,
  count: number
): string {
  return [
    briefName ? `Brand: ${briefName}` : '',
    'POST THEME:',
    themeText,
    '',
    `Choose the ${count} photographs from the library that best fit this theme,`,
    'best first. Return their numbers only.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * JSON schema for the response. Structured outputs guarantee the shape, so
 * there is no markdown-fence stripping or regex salvage to get wrong.
 */
export const SHORTLIST_SCHEMA = {
  type: 'object',
  properties: {
    indices: {
      type: 'array',
      description: 'Library numbers, best fit first.',
      items: { type: 'integer' },
    },
  },
  required: ['indices'],
  additionalProperties: false,
} as const;

/**
 * Turn the model's answer into a rank map.
 *
 * Defensive about indices even though the schema constrains the type: it
 * constrains `integer`, not `a valid index`, and a hallucinated 9999 must not
 * become an entry pointing at nothing. Out-of-range and duplicate values are
 * dropped rather than failing the whole shortlist.
 */
export function parseShortlist(
  raw: unknown,
  items: ShortlistCandidate[]
): SemanticRank | null {
  const indices = (raw as any)?.indices;
  if (!Array.isArray(indices)) return null;
  const rank: SemanticRank = new Map();
  for (const value of indices) {
    const i = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (!Number.isInteger(i) || i < 0 || i >= items.length) continue;
    const url = items[i].url;
    if (rank.has(url)) continue;
    rank.set(url, rank.size);
  }
  return rank.size > 0 ? rank : null;
}

/**
 * Ask /api/social/rank-images for a shortlist.
 *
 * Kept here rather than in each caller so Fill calendar, /api/social/draft
 * and the browser's "Generate with AI" cannot drift apart — the same mistake
 * lib/brain-image-match.ts exists to prevent for scoring.
 *
 * `origin` is '' in the browser (relative fetch) and the absolute site origin
 * server-side. `internalSecret` is required server-side, where there is no
 * session cookie: without it the auth middleware 307s to /login and the
 * shortlist silently never arrives — the same trap generateCaption documents.
 *
 * Returns null on anything at all going wrong. The caller must treat null as
 * "rank lexically", never as an error.
 */
export async function fetchSemanticRank(
  origin: string,
  items: ShortlistCandidate[],
  themeText: string,
  opts?: { briefName?: string; count?: number; internalSecret?: string; signal?: AbortSignal }
): Promise<SemanticRank | null> {
  if (items.length === 0 || !themeText.trim()) return null;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts?.internalSecret) headers['x-internal-call'] = opts.internalSecret;
    const res = await fetch(`${origin}/api/social/rank-images`, {
      method: 'POST',
      headers,
      signal: opts?.signal,
      body: JSON.stringify({
        // Only the fields the catalogue renders. Sending whole Brain items
        // would put blob ids and sizes in the prompt for no benefit.
        items: items.map(i => ({
          url: i.url, description: i.description, tags: i.tags, folder: i.folder,
        })),
        theme: themeText,
        briefName: opts?.briefName,
        count: opts?.count,
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const ranked: unknown = data?.ranked;
    if (!Array.isArray(ranked) || ranked.length === 0) return null;
    const rank: SemanticRank = new Map();
    ranked.forEach((url, i) => { if (typeof url === 'string') rank.set(url, i); });
    return rank.size > 0 ? rank : null;
  } catch {
    return null;
  }
}
