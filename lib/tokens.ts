import { getStore } from '@netlify/blobs';

/**
 * Token storage shape for each provider.
 */
export interface LinkedInTokens {
  accessToken: string;
  expiresAt: number;       // ms epoch when token expires
  refreshToken?: string;   // LinkedIn doesn't always issue these
  scopes: string[];
  memberUrn: string;       // urn:li:person:XXX
  name: string;
  email: string;
  picture?: string;
  organisations?: Array<{ id: string; name: string; urn: string }>;
  capabilities: {
    signIn?: boolean;
    postPersonal?: boolean;
    postCompany?: boolean;
    listOrganisations?: boolean;
  };
  connectedAt: number;
}

export interface MetaTokens {
  userToken: string;
  expiresAt: number;
  pages: Array<{
    id: string;
    name: string;
    pageToken: string;
    instagramId?: string;
  }>;
  connectedAt: number;
}

export interface UserTokens {
  linkedin?: LinkedInTokens;
  meta?: MetaTokens;
}

/**
 * Get the tokens blob store. Single store per app, namespaced by user key.
 */
function tokenStore() {
  return getStore({ name: 'roam-tokens', consistency: 'strong' });
}

/**
 * Read all tokens for a user. Returns empty object if nothing stored.
 */
export async function getUserTokens(userId: string): Promise<UserTokens> {
  const store = tokenStore();
  const data = await store.get(userId, { type: 'json' });
  return (data as UserTokens) || {};
}

/**
 * Save LinkedIn tokens for a user, merging with existing data.
 */
export async function saveLinkedInTokens(userId: string, tokens: LinkedInTokens): Promise<void> {
  const store = tokenStore();
  const existing = await getUserTokens(userId);
  const updated: UserTokens = { ...existing, linkedin: tokens };
  await store.setJSON(userId, updated);
}

/**
 * Save Meta (Facebook + Instagram) tokens for a user.
 */
export async function saveMetaTokens(userId: string, tokens: MetaTokens): Promise<void> {
  const store = tokenStore();
  const existing = await getUserTokens(userId);
  const updated: UserTokens = { ...existing, meta: tokens };
  await store.setJSON(userId, updated);
}

/**
 * Remove a specific provider's tokens (e.g. user clicked Disconnect).
 */
export async function deleteProviderTokens(
  userId: string,
  provider: 'linkedin' | 'meta'
): Promise<void> {
  const store = tokenStore();
  const existing = await getUserTokens(userId);
  delete existing[provider];
  await store.setJSON(userId, existing);
}

/**
 * Convenience: just the LinkedIn token bundle, or null.
 */
export async function getLinkedInTokens(userId: string): Promise<LinkedInTokens | null> {
  const all = await getUserTokens(userId);
  return all.linkedin || null;
}

/**
 * Convenience: just the Meta token bundle, or null.
 */
export async function getMetaTokens(userId: string): Promise<MetaTokens | null> {
  const all = await getUserTokens(userId);
  return all.meta || null;
}

/**
 * Default user ID — single-user mode for now.
 * When you add Sarah, this becomes the authenticated user's email/id.
 */
export const DEFAULT_USER_ID = 'andy';
