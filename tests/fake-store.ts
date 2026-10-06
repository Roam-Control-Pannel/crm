/**
 * An ETag-aware stand-in for a Netlify Blobs store, faithful to the parts
 * mutateBlob depends on: getWithMetadata returns an etag, and setJSON honours
 * onlyIfMatch / onlyIfNew and reports whether it modified anything.
 *
 * Nothing here patches node_modules. mutateBlob takes a CasStore, so a test
 * hands it one of these directly — which is most of why the interface exists.
 */
import type { CasStore } from '@/lib/blob-cas';

export interface FakeStore extends CasStore {
  /** Put a value in place without going through a conditional write. */
  seed(key: string, value: unknown): void;
  /** Read a value without affecting etags. */
  peek(key: string): any;
  /** Run `fn` after the NEXT read, to simulate another writer landing in the
   *  window between a mutation's read and its write. */
  onNextRead(fn: () => void): void;
  /** Make every read throw, to exercise the fail-closed path. */
  breakReads(broken: boolean): void;
  /** How many reads have happened, so a test can prove a retry occurred. */
  readonly reads: number;
}

export function createFakeStore(): FakeStore {
  const rows = new Map<string, { json: string; etag: string }>();
  let seq = 0;
  let afterRead: (() => void) | null = null;
  let broken = false;
  let reads = 0;

  return {
    get reads() { return reads; },
    seed(key, value) { rows.set(key, { json: JSON.stringify(value), etag: `e${++seq}` }); },
    peek(key) { const r = rows.get(key); return r ? JSON.parse(r.json) : null; },
    onNextRead(fn) { afterRead = fn; },
    breakReads(b) { broken = b; },

    async getWithMetadata(key) {
      reads++;
      if (broken) throw new Error('blobs unavailable');
      const row = rows.get(key);
      const result = row ? { data: JSON.parse(row.json), etag: row.etag } : null;
      if (afterRead) { const f = afterRead; afterRead = null; f(); }
      return result;
    },

    async setJSON(key, value, options) {
      const row = rows.get(key);
      if (options?.onlyIfNew && row) return { modified: false };
      if (options?.onlyIfMatch !== undefined && row?.etag !== options.onlyIfMatch) {
        return { modified: false };
      }
      const etag = `e${++seq}`;
      rows.set(key, { json: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
  };
}
