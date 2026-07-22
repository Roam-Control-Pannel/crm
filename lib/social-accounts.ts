import type { Brief } from './briefs';
import { loadWithMigration, saveRemote } from './client-store';

/**
 * Real account from /api/accounts/status — server-derived from OAuth tokens.
 */
export interface RealAccount {
  id: string;
  platform: 'linkedin' | 'facebook' | 'instagram';
  type: 'personal' | 'company' | 'page';
  handle: string;
  region?: string;
  capabilities: { canPost: boolean };
  pendingApproval?: boolean;
  meta?: {
    memberUrn?: string;
    pageId?: string;
    instagramId?: string;
    organizationUrn?: string;
  };
}

/**
 * Per-account metadata stored in the server store — overrides + brief mapping.
 */
/**
 * MULTI-BRIEF-V1: An account can now post under multiple briefs.
 *
 * - briefIds is the canonical list going forward.
 * - briefId is kept as a fallback ONLY for back-compat reading of records
 *   written before this patch. New writes set both (briefIds and
 *   briefId = briefIds[0]) so a rollback doesn't lose data.
 * - perBriefOverrides keys by briefId. Falls back to the flat tone/hashtags/
 *   contentBrief override fields (also kept for back-compat) when a
 *   per-brief entry doesn't exist.
 */
export interface PerBriefOverride {
  tone?: string;
  hashtags?: string;
  contentBrief?: string;
}

export interface AccountMeta {
  accountId: string;        // matches RealAccount.id
  briefIds?: string[];      // MULTI-BRIEF-V1: canonical list
  perBriefOverrides?: Record<string, PerBriefOverride>;
  // Legacy fields — read for back-compat, written alongside the new ones.
  briefId?: string;
  toneOverride?: string;
  hashtagsOverride?: string;
  contentBriefOverride?: string;
  active?: boolean;         // user can pause an account; default true
  color?: string;           // optional accent colour for calendar pills
}

/**
 * MULTI-BRIEF-V1: Read the effective list of brief IDs for an account,
 * supporting both new and legacy storage shapes. Single source of truth
 * for "which briefs does this account post under?".
 */
export function getEffectiveBriefIds(meta: AccountMeta | undefined): string[] {
  if (!meta) return [];
  if (Array.isArray(meta.briefIds) && meta.briefIds.length > 0) return meta.briefIds;
  if (meta.briefId) return [meta.briefId];
  return [];
}

/**
 * MULTI-BRIEF-V1: Read the effective per-brief override, falling back
 * to the legacy flat override fields if a brief-specific record doesn't
 * exist. Returns an object with tone/hashtags/contentBrief possibly
 * undefined (use the brief's defaults in that case).
 */
export function getEffectiveOverrides(
  meta: AccountMeta | undefined,
  briefId: string,
): PerBriefOverride {
  if (!meta) return {};
  const perBrief = meta.perBriefOverrides?.[briefId];
  if (perBrief) {
    // Per-brief wins where present, legacy fills in any gaps for
    // single-brief accounts upgrading from pre-patch data.
    return {
      tone: perBrief.tone || meta.toneOverride,
      hashtags: perBrief.hashtags || meta.hashtagsOverride,
      contentBrief: perBrief.contentBrief || meta.contentBriefOverride,
    };
  }
  // No per-brief entry — fall back to legacy flat overrides.
  return {
    tone: meta.toneOverride,
    hashtags: meta.hashtagsOverride,
    contentBrief: meta.contentBriefOverride,
  };
}

/**
 * Combined view that UI components consume — real account + its metadata.
 */
export interface SocialAccount extends RealAccount {
  // MULTI-BRIEF-V1: array, with brief[0] still hydrated as `brief` for
  // any old UI code that hasn't been upgraded yet.
  briefIds: string[];
  briefs: Brief[];          // all hydrated briefs the account posts under
  briefId?: string;         // legacy: briefIds[0]
  brief?: Brief;            // legacy: briefs[0]
  perBriefOverrides?: Record<string, PerBriefOverride>;
  toneOverride?: string;
  hashtagsOverride?: string;
  contentBriefOverride?: string;
  active: boolean;
  color: string;
}

const PLATFORM_DEFAULT_COLORS: Record<string, string> = {
  linkedin: '#0A66C2',
  facebook: '#1877F2',
  instagram: '#E4405F',
};

/**
 * Fetch account metadata from the server store. Migrates legacy localStorage
 * data on first call.
 */
export async function fetchAccountMeta(): Promise<AccountMeta[]> {
  const data = await loadWithMigration<AccountMeta[]>('account_meta');
  return Array.isArray(data) ? data : [];
}

export async function saveAccountMeta(metas: AccountMeta[]): Promise<void> {
  await saveRemote('account_meta', metas);
}

/**
 * Upsert a single piece of account metadata. Reads current state, applies the
 * patch, writes back. Returns the new full list.
 */
export async function upsertAccountMeta(patch: AccountMeta): Promise<AccountMeta[]> {
  const all = await fetchAccountMeta();
  const idx = all.findIndex(m => m.accountId === patch.accountId);
  if (idx === -1) {
    all.push(patch);
  } else {
    all[idx] = { ...all[idx], ...patch };
  }
  await saveAccountMeta(all);
  return all;
}

/**
 * Combine a list of real accounts with metadata + brief data
 * to produce the UI-ready SocialAccount[] list.
 */
export function combineAccounts(
  real: RealAccount[],
  briefs: Brief[],
  metas: AccountMeta[]
): SocialAccount[] {
  return real.map(r => {
    const meta = metas.find(m => m.accountId === r.id);
    const briefIds = getEffectiveBriefIds(meta);
    const hydratedBriefs = briefIds
      .map(id => briefs.find(b => b.id === id))
      .filter((b): b is Brief => !!b);
    return {
      ...r,
      briefIds,
      briefs: hydratedBriefs,
      briefId: hydratedBriefs[0]?.id,           // legacy mirror
      brief: hydratedBriefs[0],                  // legacy mirror
      perBriefOverrides: meta?.perBriefOverrides,
      toneOverride: meta?.toneOverride,
      hashtagsOverride: meta?.hashtagsOverride,
      contentBriefOverride: meta?.contentBriefOverride,
      active: meta?.active !== false,
      color: meta?.color || PLATFORM_DEFAULT_COLORS[r.platform] || '#6b7280',
    };
  });
}

/**
 * HANDLE-CACHE-V1: last-known display names for real accounts, keyed by
 * account id. /api/accounts/status returns nothing for a provider whose
 * token has expired, which used to leave the UI with only raw ids like
 * 'meta-page:1724917047779739'. The cache is merge-only (entries are never
 * deleted on disconnect — that's the whole point), so once an account has
 * been seen connected its human name survives token lapses.
 */
export type AccountHandleCache = Record<string, { handle: string; platform: string }>;

export async function fetchAccountHandleCache(): Promise<AccountHandleCache> {
  const data = await loadWithMigration<AccountHandleCache>('account_handle_cache');
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/**
 * Merge freshly-fetched real accounts into the cache. Writes to the server
 * store only when something actually changed, so the common page-load path
 * costs a read, not a write.
 */
export async function updateAccountHandleCache(real: RealAccount[]): Promise<AccountHandleCache> {
  const cache = await fetchAccountHandleCache();
  let changed = false;
  for (const r of real) {
    const cur = cache[r.id];
    if (!cur || cur.handle !== r.handle || cur.platform !== r.platform) {
      cache[r.id] = { handle: r.handle, platform: r.platform };
      changed = true;
    }
  }
  if (changed) await saveRemote('account_handle_cache', cache);
  return cache;
}

/**
 * Fetch real accounts from the server.
 */
export async function fetchRealAccounts(): Promise<RealAccount[]> {
  try {
    const res = await fetch('/api/accounts/status');
    if (!res.ok) return [];
    const data = await res.json();
    return data.realAccounts || [];
  } catch (e) {
    console.error('Failed to fetch real accounts', e);
    return [];
  }
}
