import { getStore } from '@netlify/blobs';
import { mutateBlob, BlobConflictError, isBlobConflictError } from './blob-cas';

// Re-exported so collection callers have one import for the store and the
// error their writes can raise.
export { BlobConflictError, isBlobConflictError };

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
 * COLLECTION-CAS-V1 — compare-and-swap for a collection.
 *
 * A thin wrapper over mutateBlob (lib/blob-cas.ts), which holds the mechanism
 * and the reasoning. This exists so collection callers do not have to know
 * which store or key a collection lives in.
 *
 * `apply` MUST be pure: it re-runs on every retry. See mutateBlob.
 */
export async function mutateCollection<T = unknown>(
  userId: string,
  key: CollectionKey,
  apply: (current: T | null) => T,
  options?: { what?: string; attempts?: number }
): Promise<T> {
  return mutateBlob<T>(dataStore(), blobKey(userId, key), apply, {
    what: options?.what || `the ${key} collection`,
    attempts: options?.attempts,
  });
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
