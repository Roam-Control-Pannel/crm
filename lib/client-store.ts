/**
 * Client-side helper for the per-user store.
 *
 * Provides a small fetch wrapper that mirrors the server `getCollection` /
 * `saveCollection` API. Also handles a one-time migration from the legacy
 * localStorage keys so users don't lose data they accumulated before the
 * server-side store existed.
 */

export type CollectionKey =
  | 'social_posts'
  | 'briefs'
  | 'account_meta'
  | 'account_handle_cache'
  | 'tasks'
  | 'hub_docs'
  | 'hub_chats';

/**
 * Map of collection key -> legacy localStorage key.
 * Used by the migration helper to read old data once and copy it to the server.
 */
const LEGACY_KEYS: Record<CollectionKey, string> = {
  social_posts: 'roam_social_posts',
  briefs: 'roam_briefs',
  account_meta: 'roam_account_meta',
  // No pre-server-store legacy data for this one — key exists so the
  // Record type stays total; migration simply finds nothing.
  account_handle_cache: 'roam_account_handle_cache',
  tasks: 'roam_tasks',
  hub_docs: 'roam_docs',
  hub_chats: 'roam_chats',
};

const MIGRATION_FLAG_PREFIX = 'roam_migrated_';

export async function getRemote<T>(key: CollectionKey): Promise<T | null> {
  const res = await fetch(`/api/store/${key}`, { cache: 'no-store' });
  if (!res.ok) {
    console.error(`getRemote(${key}) failed: ${res.status}`);
    return null;
  }
  const json = await res.json();
  return (json?.data as T) ?? null;
}

export async function saveRemote<T>(key: CollectionKey, data: T): Promise<boolean> {
  try {
    const res = await fetch(`/api/store/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      console.error(`saveRemote(${key}) failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`saveRemote(${key}) threw:`, err);
    return false;
  }
}

/**
 * One-time migration: if there's no server-side data for `key` but the legacy
 * localStorage value exists, push it up to the server. Marks the migration as
 * done in localStorage so we don't repeat it.
 *
 * Returns the data that should now be considered authoritative (server, falling
 * back to whatever was in localStorage, falling back to null).
 */
export async function loadWithMigration<T>(key: CollectionKey): Promise<T | null> {
  // Server first.
  const remote = await getRemote<T>(key);
  if (remote !== null && remote !== undefined) {
    return remote;
  }

  // Server has nothing — see if localStorage has legacy data we can promote.
  if (typeof window === 'undefined') return null;

  const legacyKey = LEGACY_KEYS[key];
  const flag = MIGRATION_FLAG_PREFIX + key;
  if (localStorage.getItem(flag) === '1') {
    return null; // already attempted, server is genuinely empty
  }

  const raw = localStorage.getItem(legacyKey);
  if (!raw) {
    localStorage.setItem(flag, '1');
    return null;
  }

  let parsed: T | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (parsed !== null && parsed !== undefined) {
    const ok = await saveRemote(key, parsed);
    if (ok) {
      localStorage.setItem(flag, '1');
      console.info(`Migrated ${key} from localStorage to server store.`);
    }
  } else {
    localStorage.setItem(flag, '1');
  }

  return parsed;
}
