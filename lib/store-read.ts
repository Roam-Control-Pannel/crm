/**
 * FAIL-CLOSED-READS-V1
 *
 * A read that failed and a key that holds nothing look identical if both
 * return `[]` / `null`, and almost every store in this app is read-modify-
 * write. That equivalence is what turns a momentary Blobs blip into data
 * loss:
 *
 *   - lib/briefs.ts saw `null`, concluded "first run", and persisted the
 *     three DEFAULT_BRIEFS over the user's real ones;
 *   - /api/brain/items saw `[]`, appended the new upload, and wrote a
 *     one-item index over the entire Brain;
 *   - lib/cron-status.ts saw `{ history: [] }`, so sendsToday() returned 0
 *     and the 50/day send cap reset mid-day;
 *   - lib/social-accounts.ts saw `[]` and wrote back account metadata with
 *     every pause state and brief assignment gone.
 *
 * In every case the read failure was logged and then discarded, and the
 * write that followed was the thing that destroyed data.
 *
 * The rule this module enforces: a read either returns what is stored
 * (`null` when genuinely nothing is), or it throws. It never invents a
 * value. Callers that write MUST let the throw propagate — refusing to
 * write is always recoverable, writing a default never is. Callers that
 * only display may catch, but they have to do so deliberately.
 */

export class StoreReadError extends Error {
  readonly what: string;
  constructor(what: string, cause?: unknown) {
    super(
      `Could not read ${what}. Refusing to continue, because the caller would ` +
        `otherwise persist a default over stored data.`
    );
    this.name = 'StoreReadError';
    this.what = what;
    // `cause` is standard on Error in Node 18+, but assign defensively so
    // this compiles against older lib targets too.
    (this as any).cause = cause;
  }
}

export function isStoreReadError(err: unknown): err is StoreReadError {
  return err instanceof StoreReadError || (err as any)?.name === 'StoreReadError';
}

/**
 * Run a store read, turning a thrown/rejected read into a StoreReadError and
 * leaving "nothing stored" as a plain `null`.
 *
 * @param what  Human-readable name of what was being read, used in the error
 *              message and the server log (e.g. 'the Brain index').
 */
export async function readStored<T>(
  what: string,
  read: () => Promise<unknown>
): Promise<T | null> {
  let data: unknown;
  try {
    data = await read();
  } catch (err) {
    console.error(`[store] read failed for ${what}:`, err);
    throw new StoreReadError(what, err);
  }
  return (data as T) ?? null;
}

/**
 * Shape a caught error into the JSON body + HTTP status a route should
 * return. A read failure is a 503 (transient, retryable, nothing was
 * written) rather than a 500, so the client can say "try again" instead of
 * "something broke" — and so it is distinguishable in logs from a genuine
 * bug.
 */
export function readErrorResponse(err: unknown): {
  body: { ok: false; error: string; retryable: boolean };
  status: number;
} {
  if (isStoreReadError(err)) {
    return {
      body: { ok: false, error: (err as StoreReadError).message, retryable: true },
      status: 503,
    };
  }
  return {
    body: { ok: false, error: (err as any)?.message || 'Request failed', retryable: false },
    status: 500,
  };
}
