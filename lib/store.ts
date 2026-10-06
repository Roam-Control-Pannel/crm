import { getStore } from '@netlify/blobs';
import { readStored } from './store-read';

/**
 * Generic per-user JSON store backed by Netlify Blobs.
 *
 * All app data (posts, briefs, tasks, etc.) lives here, namespaced by user.
 * Each "collection" is a named JSON document stored under a single key
 * `${userId}:${collectionKey}`.
 *
 * Single-user mode for now — see DEFAULT_USER_ID. When multi-user is added,
 * pass the authenticated user's id from session into get/save calls.
 */

export const DEFAULT_USER_ID = 'andy';

/**
 * Allowed collection keys. Keep this list narrow so the store endpoint can
 * validate incoming requests and reject anything unknown.
 */
export const COLLECTION_KEYS = [
  'social_posts',
  'briefs',
  'account_meta',
  'account_handle_cache',
  'tasks',
  'hub_docs',
  'hub_chats',
] as const;

export type CollectionKey = (typeof COLLECTION_KEYS)[number];

export function isCollectionKey(value: string): value is CollectionKey {
  return (COLLECTION_KEYS as readonly string[]).includes(value);
}

function dataStore() {
  return getStore({ name: 'roam-data', consistency: 'strong' });
}

function blobKey(userId: string, key: CollectionKey): string {
  return `${userId}:${key}`;
}

/**
 * Read a collection. Returns null if nothing has been stored yet so the
 * caller can distinguish "first run" (seed defaults) from "empty array".
 */
export async function getCollection<T = unknown>(
  userId: string,
  key: CollectionKey
): Promise<T | null> {
  const store = dataStore();
  const data = await store.get(blobKey(userId, key), { type: 'json' });
  return (data as T) ?? null;
}

/**
 * Write a collection, fully replacing existing data.
 */
export async function saveCollection<T = unknown>(
  userId: string,
  key: CollectionKey,
  data: T
): Promise<void> {
  const store = dataStore();
  await store.setJSON(blobKey(userId, key), data as any);
}

/**
 * COLLECTION-CAS-V1
 *
 * Raised when a mutation could not be applied because another writer kept
 * winning the race. The caller's change was NOT persisted — which is the
 * point. The alternative, writing anyway, is what the double-publish was.
 */
export class CollectionConflictError extends Error {
  readonly key: CollectionKey;
  readonly attempts: number;
  constructor(key: CollectionKey, attempts: number) {
    super(
      `Could not update ${key}: another write landed first on all ${attempts} ` +
        `attempts. Nothing was saved; retry the operation.`
    );
    this.name = 'CollectionConflictError';
    this.key = key;
    this.attempts = attempts;
  }
}

export function isCollectionConflictError(err: unknown): err is CollectionConflictError {
  return (
    err instanceof CollectionConflictError || (err as any)?.name === 'CollectionConflictError'
  );
}

const DEFAULT_MUTATE_ATTEMPTS = 4;

/**
 * COLLECTION-CAS-V1 — read, apply, write, but only if nothing changed underneath.
 *
 * Nearly every store in this app is read-modify-write over a single JSON
 * document, and `saveCollection` replaces that document wholesale. Two
 * writers overlapping therefore does not merge or conflict — the later write
 * silently reinstates everything the earlier one changed.
 *
 * That is not theoretical. It is written up three times in this codebase
 * already (AUTOGEN-MERGE-ON-WRITE-V1, REGENERATE-MERGE-ON-WRITE-V1, and the
 * per-post claim in publish-due), each time as a local fix beside the code
 * that needed it. The worst case is specific and public: publish-due marks a
 * post `published` mid-flight, an overlapping writer puts back a snapshot
 * taken moments earlier in which it was still `scheduled`, and the next tick
 * publishes it to LinkedIn, Facebook and Instagram a second time.
 *
 * Narrowing the window is not the same as closing it, so this does not try
 * to. Netlify Blobs exposes an ETag and a conditional write, so the write
 * here only lands if the document is byte-for-byte the one `apply` was given.
 * If it is not, we re-read and re-apply against the new state. A mutation
 * that cannot win within `attempts` throws rather than clobbering.
 *
 * `apply` MUST be a pure function of the state it is handed: it runs again on
 * every retry, so it cannot carry over anything derived from an earlier read
 * (a captured index, a count, a snapshot of a sibling row). Take the current
 * value, return the next one.
 *
 * Reads are fail-closed in the FAIL-CLOSED-READS-V1 sense: a read that errors
 * throws StoreReadError and nothing is written. `null` means the key genuinely
 * holds nothing, and the write then uses create-only semantics so two "first"
 * writers cannot both think they are first.
 *
 * @returns the value actually persisted.
 */
export async function mutateCollection<T = unknown>(
  userId: string,
  key: CollectionKey,
  apply: (current: T | null) => T,
  options?: { what?: string; attempts?: number }
): Promise<T> {
  const store = dataStore();
  const blob = blobKey(userId, key);
  const what = options?.what || `the ${key} collection`;
  const attempts = options?.attempts ?? DEFAULT_MUTATE_ATTEMPTS;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const read = await readStored<{ data: T; etag?: string }>(what, () =>
      store.getWithMetadata(blob, { type: 'json', consistency: 'strong' })
    );

    const current = (read?.data as T) ?? null;
    const next = apply(current);

    // An absent key and a present one need different conditions: create-only
    // for the first write, match-the-etag for every other. Passing both is a
    // type error in the client, and passing neither is the bug this exists
    // to remove.
    const write =
      read && read.etag
        ? await store.setJSON(blob, next as any, { onlyIfMatch: read.etag })
        : await store.setJSON(blob, next as any, { onlyIfNew: true });

    if (write.modified) return next;

    console.warn(
      `[store] ${key}: write ${attempt}/${attempts} lost a race, re-applying against the newer value`
    );
  }

  throw new CollectionConflictError(key, attempts);
}

/**
 * Delete a collection entirely.
 */
export async function deleteCollection(
  userId: string,
  key: CollectionKey
): Promise<void> {
  const store = dataStore();
  await store.delete(blobKey(userId, key));
}
