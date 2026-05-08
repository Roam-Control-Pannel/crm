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
export interface AccountMeta {
  accountId: string;        // matches RealAccount.id
  briefId?: string;
  toneOverride?: string;    // optional override on brief tone
  hashtagsOverride?: string;
  contentBriefOverride?: string;
  active?: boolean;         // user can pause an account; default true
  color?: string;           // optional accent colour for calendar pills
}

/**
 * Combined view that UI components consume — real account + its metadata.
 */
export interface SocialAccount extends RealAccount {
  briefId?: string;
  brief?: Brief;            // hydrated from briefs lib if briefId set
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
    const brief = meta?.briefId ? briefs.find(b => b.id === meta.briefId) : undefined;
    return {
      ...r,
      briefId: meta?.briefId,
      brief,
      toneOverride: meta?.toneOverride,
      hashtagsOverride: meta?.hashtagsOverride,
      contentBriefOverride: meta?.contentBriefOverride,
      active: meta?.active !== false,
      color: meta?.color || PLATFORM_DEFAULT_COLORS[r.platform] || '#6b7280',
    };
  });
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
