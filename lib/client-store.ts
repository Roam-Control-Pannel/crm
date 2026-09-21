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

/**
 * FAIL-CLOSED-READS-V1
 *
 * The result of a read, with "the server has nothing" and "the read failed"
 * kept apart. They used to both be `null`, and because every caller of
 * loadWithMigration() is part of a read-modify-write, that ambiguity was
 * directly destructive:
 *
 *   - lib/briefs.ts treated null as "first run" and persisted the three
 *     DEFAULT_BRIEFS over the user's real ones;
 *   - lib/social-accounts.ts treated it as "no metadata" and wrote back an
 *     array with every pause state and brief assignment dropped;
 *   - worse, loadWithMigration() itself fell through to the localStorage
 *     migration branch on a failed read, so a stale legacy blob could be
 *     PUSHED UP over live server data.
 *
 * Returning a discriminated result rather than throwing is deliberate: it
 * makes the compiler visit every call site, and it lets each one choose
 * between "show an error" and "block the write" explicitly.
 */
/**
 * Deliberately ONE interface rather than a discriminated union: this project
 * compiles with `strict: false`, so `data: T | null` collapses to `T` and a
 * union on `ok` does not narrow. A flat shape gives the same runtime contract
 * and still changes the return type, which is what makes the compiler walk
 * every call site.
 *
 * `ok: false` means the read failed and `data` is meaningless.
 * `ok: true` with `data: null` means the store genuinely holds nothing.
 */
export interface ReadResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

export async function getRemote<T>(key: CollectionKey): Promise<ReadResult<T>> {
  try {
    const res = await fetch(`/api/store/${key}`, { cache: 'no-store' });
    if (!res.ok) {
      console.error(`getRemote(${key}) failed: ${res.status}`);
      return { ok: false, data: null, error: `Could not load ${key} (server returned ${res.status})` };
    }
    const json = await res.json();
    return { ok: true, data: (json?.data as T) ?? null };
  } catch (err: any) {
    console.error(`getRemote(${key}) threw:`, err);
    return { ok: false, data: null, error: `Could not load ${key} (${err?.message || 'network error'})` };
  }
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
export async function loadWithMigration<T>(key: CollectionKey): Promise<ReadResult<T>> {
  // Server first.
  const remote = await getRemote<T>(key);
  // FAIL-CLOSED-READS-V1: a failed read stops here. Falling through to the
  // migration branch below would let stale localStorage data be written over
  // whatever the server actually holds.
  if (!remote.ok) return remote;
  if (remote.data !== null && remote.data !== undefined) {
    return remote;
  }

  // Server genuinely has nothing — see if localStorage has legacy data we
  // can promote.
  if (typeof window === 'undefined') return { ok: true, data: null };

  const legacyKey = LEGACY_KEYS[key];
  const flag = MIGRATION_FLAG_PREFIX + key;
  if (localStorage.getItem(flag) === '1') {
    // Already attempted; the server is genuinely empty.
    return { ok: true, data: null };
  }

  const raw = localStorage.getItem(legacyKey);
  if (!raw) {
    localStorage.setItem(flag, '1');
    return { ok: true, data: null };
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

  return { ok: true, data: parsed };
}
