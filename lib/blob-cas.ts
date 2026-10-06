// BLOB-CAS-V1
//
// Compare-and-swap for a Netlify Blobs document.
//
// Nearly every store in this app is read-modify-write over a single JSON
// blob, and a plain `setJSON` replaces that blob wholesale. Two writers
// overlapping therefore does not merge and does not conflict — the later
// write silently reinstates everything the earlier one changed. The symptom
// is always the same shape and never looks like a race from the outside:
// a setting reverts, a notification vanishes, a job disappears, a post that
// was published is `scheduled` again.
//
// The pattern had been written out correctly at least four times in this
// codebase (AUTOGEN-MERGE-ON-WRITE-V1, REGENERATE-MERGE-ON-WRITE-V1, the
// per-post claim in publish-due, and the one in lib/store.ts that shipped
// with the double-publish fix), each time beside the one caller that needed
// it, and each time leaving its siblings alone. That is why this lives on its
// own: the store a caller writes to should not decide whether its writes are
// safe.
//
// Netlify Blobs gives us an ETag and a conditional write, so this is a real
// compare-and-swap rather than a narrowed window: the write lands only if the
// document is byte-for-byte the one `apply` was handed, and otherwise we
// re-read and re-apply against whatever is there now.

import { readStored } from './store-read';

/**
 * The slice of a Netlify Blobs `Store` this needs. Declared structurally so
 * callers can pass a real store, a deploy store, or a stand-in in tests
 * without any of them having to import the other.
 */
export interface CasStore {
  getWithMetadata(
    key: string,
    options: { type: 'json'; consistency?: 'strong' | 'eventual' }
  ): Promise<{ data: any; etag?: string } | null>;
  setJSON(
    key: string,
    value: any,
    options?: { onlyIfMatch?: string; onlyIfNew?: boolean }
  ): Promise<{ modified: boolean; etag?: string }>;
}

/**
 * Raised when a mutation could not be applied because another writer kept
 * winning. The caller's change was NOT persisted — which is the point. The
 * alternative, writing anyway, is the bug this module exists to remove.
 */
export class BlobConflictError extends Error {
  readonly key: string;
  readonly attempts: number;
  constructor(key: string, attempts: number) {
    super(
      `Could not update ${key}: another write landed first on all ${attempts} ` +
        `attempts. Nothing was saved; retry the operation.`
    );
    this.name = 'BlobConflictError';
    this.key = key;
    this.attempts = attempts;
  }
}

export function isBlobConflictError(err: unknown): err is BlobConflictError {
  return err instanceof BlobConflictError || (err as any)?.name === 'BlobConflictError';
}

export const DEFAULT_MUTATE_ATTEMPTS = 4;

/**
 * Read, apply, write — but only if nothing changed underneath.
 *
 * `apply` MUST be a pure function of the state it is handed. It runs again on
 * every retry, so it cannot carry anything over from an earlier read: not a
 * captured index, not a count, not a snapshot of a neighbouring row. Take the
 * current value, return the next one.
 *
 * Reads are fail-closed in the FAIL-CLOSED-READS-V1 sense — a read that errors
 * throws and nothing is written, because a write built on an invented empty
 * value is how this codebase has lost data before. `null` means the key
 * genuinely holds nothing, and the write then uses create-only semantics so
 * two writers cannot both believe they are the first.
 *
 * @returns the value actually persisted.
 */
export async function mutateBlob<T = unknown>(
  store: CasStore,
  key: string,
  apply: (current: T | null) => T,
  options?: { what?: string; attempts?: number }
): Promise<T> {
  const what = options?.what || `the ${key} blob`;
  const attempts = options?.attempts ?? DEFAULT_MUTATE_ATTEMPTS;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const read = await readStored<{ data: T; etag?: string }>(what, () =>
      store.getWithMetadata(key, { type: 'json', consistency: 'strong' })
    );

    const current = (read?.data as T) ?? null;
    const next = apply(current);

    // An absent key and a present one need different conditions: create-only
    // for the first write, match-the-etag for every other. Passing neither is
    // the bug this exists to remove.
    const write = read?.etag
      ? await store.setJSON(key, next as any, { onlyIfMatch: read.etag })
      : await store.setJSON(key, next as any, { onlyIfNew: true });

    if (write.modified) return next;

    console.warn(
      `[blob-cas] ${key}: write ${attempt}/${attempts} lost a race, re-applying against the newer value`
    );
  }

  throw new BlobConflictError(key, attempts);
}
