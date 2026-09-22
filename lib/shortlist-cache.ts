/**
 * SHORTLIST-CACHE-V1
 *
 * Persist IMAGE-SEMANTIC-V1 shortlists across invocations.
 *
 * Two problems, one cause. A 14-day fill is ~21 invocations of
 * runAutoGenerate, and the rank cache in makeRankCache lives for exactly one
 * of them. So the same ~25 (theme, brief) pairs were re-ranked on every
 * invocation: ~500 requests per fill instead of ~25, and — far worse — the
 * generation loop had to reserve the shortlist timeout out of its budget on
 * every single one. With the caption timeout that reserve left 2.5s for the
 * whole setup phase, and a real account (151 posts, 324 Brain images) does
 * not finish setup in 2.5s. The run then created nothing and the UI reported
 * "generation stalled".
 *
 * A shortlist is a pure function of (theme text, brief, photo library), none
 * of which change during a fill, so caching it is not a heuristic — it is the
 * same answer, not recomputed. The fingerprint covers the library so adding
 * photos re-ranks; the TTL covers theme text being edited, which the
 * fingerprint cannot see.
 */

import { getStore } from '@netlify/blobs';
import { readStored } from '@/lib/store-read';

const STORE_NAME = 'roam-system';
const KEY = 'social-shortlists';

/**
 * How long an entry stays usable. Long, because the inputs barely move: the
 * library is fingerprinted, so this only bounds how stale an edited theme's
 * shortlist can be. A week means a reworded theme is re-ranked within a week
 * even if nobody touches the Brain.
 */
export const SHORTLIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface ShortlistBlob {
  version: 1;
  /** Which photo library these were computed against. */
  fingerprint: string;
  entries: Record<string, { ranked: string[]; at: number }>;
}

/**
 * A cheap, stable fingerprint of the photo library.
 *
 * FNV-1a over the sorted urls plus the count. Sorted so the store's iteration
 * order cannot invalidate a perfectly good cache; a hash rather than the
 * urls themselves so the blob stays small. This is a cache key, not a
 * security boundary — a collision costs one stale shortlist.
 */
export function brainFingerprint(items: Array<{ url: string }>): string {
  const urls = items.map(i => i.url).sort();
  let hash = 0x811c9dc5;
  for (const url of urls) {
    for (let i = 0; i < url.length; i++) {
      hash ^= url.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `${urls.length}:${(hash >>> 0).toString(36)}`;
}

export interface ShortlistCache {
  /** Entries valid for this fingerprint, keyed themeId|briefId. */
  hits: Map<string, string[]>;
  /** True when nothing usable was loaded — the caller must reserve time. */
  cold: boolean;
}

export const EMPTY_SHORTLIST_CACHE: ShortlistCache = { hits: new Map(), cold: true };

/**
 * Load the cache for one library fingerprint.
 *
 * A read failure returns a cold cache rather than throwing: unlike the stores
 * FAIL-CLOSED-READS-V1 covers, nothing is written back on this path when the
 * read failed (see writeShortlists), so there is no default to persist over
 * real data. The cost of a failed read is re-ranking, which is correct, just
 * slower.
 */
export async function readShortlists(fingerprint: string): Promise<ShortlistCache> {
  let blob: ShortlistBlob | null = null;
  try {
    blob = await readStored<ShortlistBlob>('the image shortlist cache', () =>
      getStore({ name: STORE_NAME, consistency: 'strong' }).get(KEY, { type: 'json' })
    );
  } catch {
    return { hits: new Map(), cold: true };
  }
  if (!blob || blob.version !== 1 || blob.fingerprint !== fingerprint) {
    // A changed library invalidates every entry at once, which is what we
    // want: adding photos should let them compete for every theme.
    return { hits: new Map(), cold: true };
  }
  const now = Date.now();
  const hits = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(blob.entries || {})) {
    if (!entry || !Array.isArray(entry.ranked)) continue;
    if (now - (entry.at || 0) > SHORTLIST_TTL_MS) continue;
    hits.set(key, entry.ranked);
  }
  return { hits, cold: hits.size === 0 };
}

/**
 * Merge newly computed shortlists in.
 *
 * Read-modify-write on a blob two invocations could touch at once. The fill
 * loop is sequential, so that is not expected, and the cost if it ever
 * happened is a lost entry — re-ranked next time. Worth naming rather than
 * pretending the window does not exist.
 */
export async function writeShortlists(
  fingerprint: string,
  fresh: Map<string, string[]>
): Promise<void> {
  if (fresh.size === 0) return;
  try {
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const existing = (await store.get(KEY, { type: 'json' })) as ShortlistBlob | null;
    const base: ShortlistBlob =
      existing && existing.version === 1 && existing.fingerprint === fingerprint
        ? existing
        : { version: 1, fingerprint, entries: {} };
    const at = Date.now();
    for (const [key, ranked] of fresh) base.entries[key] = { ranked, at };
    base.fingerprint = fingerprint;
    await store.setJSON(KEY, base as any);
  } catch (err) {
    // A cache that cannot be written is a slow fill, not a broken one.
    console.warn('[shortlist-cache] could not persist shortlists:', err);
  }
}
