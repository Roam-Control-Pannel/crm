import { getStore } from '@netlify/blobs';
import { readStored, isStoreReadError } from './store-read';

/**
 * System-level state for the daily outreach sequences cron.
 *
 * Persists a small status blob so the UI can show "last run" info without
 * hitting Brevo. Also enforces the daily send cap by tracking how many
 * emails have been sent today.
 */

export interface CronRunRecord {
  ranAt: string;            // ISO timestamp
  ok: boolean;
  day2Sent: number;         // follow-ups sent (step 2)
  day7Sent: number;         // final nudges sent (step 3)
  day14Cold: number;        // contacts marked cold
  errors: number;
  capped: boolean;          // true if run hit the daily send cap
  message: string;
}

export interface CronStatus {
  lastRun?: CronRunRecord;
  history: CronRunRecord[]; // most recent 14 entries, newest first
}

/**
 * INBOUND-HEALTH-V1
 *
 * The inbound IMAP poller was the only scheduled job with no health surface
 * at all: nothing recorded or exposed a run, and /api/settings/diagnostics
 * and /api/sequences/status both reported the sequences cron only. When the
 * poller stopped, replies were never ingested, OUTREACH_STATUS was never
 * flipped to `responded`, and the 08:00 sequences run went on to send a
 * "final nudge" to prospects who had already written back — with nothing
 * anywhere in the UI to show the poller had died.
 *
 * Deliberately a separate, smaller record from CronRunRecord: the two jobs
 * share a store but not a shape, and overloading the sequences history would
 * corrupt sendsToday().
 */
export interface InboundRunRecord {
  ranAt: string;   // ISO timestamp
  ok: boolean;
  fetched: number; // replies pulled from the mailbox
  errors: number;
  message: string;
}

export interface InboundStatus {
  lastRun?: InboundRunRecord;
  history: InboundRunRecord[];
}

const STORE_NAME = 'roam-system';
const KEY = 'sequences-cron-status';
const CLAIM_KEY = 'sequences-cron-claim';
const INBOUND_KEY = 'inbound-poll-status';
const HISTORY_LIMIT = 14;

function statusStore() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

/**
 * FAIL-CLOSED-READS-V1
 * Returns `{ history: [] }` only when nothing has ever been recorded;
 * THROWS StoreReadError if the read itself failed. It used to swallow the
 * failure and return an empty history, which had two consequences: the next
 * recordCronRun() wrote that empty history back over fourteen days of run
 * records, and sendsToday() counted zero — silently resetting the 50/day
 * send cap mid-day and letting the cron send a second full batch.
 */
export async function getCronStatus(): Promise<CronStatus> {
  const data = await readStored<CronStatus>('the cron run history', () =>
    statusStore().get(KEY, { type: 'json' })
  );
  return data ?? { history: [] };
}

export async function recordCronRun(record: CronRunRecord): Promise<void> {
  const store = statusStore();
  let current: CronStatus;
  try {
    current = await getCronStatus();
  } catch (err) {
    // Deliberately the one place that swallows: this is called at the very
    // end of a run, including from the sequences route's error path, and
    // throwing here would mask the real outcome (or the real error) of a run
    // whose emails have already gone out. Losing ONE run record is strictly
    // better than writing a single-entry history over the other thirteen —
    // and better than this throw propagating in place of the 500 the caller
    // is trying to return.
    if (isStoreReadError(err)) {
      console.error(
        '[cron-status] history unreadable — skipping the run record rather than ' +
          'overwriting existing history. Run outcome was:',
        JSON.stringify(record)
      );
      return;
    }
    throw err;
  }
  const next: CronStatus = {
    lastRun: record,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  };
  await store.setJSON(KEY, next as any);
}

/**
 * Claim the daily scheduled sequences run for `dateStr` (YYYY-MM-DD).
 *
 * Returns true if THIS caller acquired the claim, false if it was already
 * claimed for that date. This lets a redundant trigger (e.g. a GitHub Actions
 * backup) run the daily sequence ONLY when the primary Netlify cron didn't —
 * without risk of double-emailing contacts. Whoever claims the day first does
 * the work; later scheduled callers see the claim and skip.
 *
 * The store uses strong consistency, so the read sees a prior claim from any
 * non-simultaneous caller. The remaining read-then-write window is sub-second;
 * combined with scheduling the backup well after the primary's slot, two
 * scheduled runs claiming the same day is effectively impossible. Manual
 * "Run now" calls do not go through this path, so they are never blocked.
 */
export async function claimDailyRun(dateStr: string): Promise<boolean> {
  const store = statusStore();
  const existing = (await store.get(CLAIM_KEY, { type: 'json' })) as { date?: string } | null;
  if (existing?.date === dateStr) return false;
  await store.setJSON(CLAIM_KEY, { date: dateStr, claimedAt: new Date().toISOString() });
  return true;
}

/**
 * Counts how many sends have happened so far today. Used by the cron to
 * enforce the 50/day send cap.
 *
 * FAIL-CLOSED-READS-V1: propagates a StoreReadError rather than reporting 0.
 * A zero here reads as "nothing sent today" and re-opens the full daily cap,
 * so the honest outcome of an unreadable history is that the run refuses to
 * send at all — no emails is recoverable, a second batch of 50 is not.
 */
export async function sendsToday(): Promise<number> {
  const status = await getCronStatus();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let total = 0;
  for (const entry of status.history) {
    if (!entry.ranAt.startsWith(today)) break; // history is newest-first
    total += (entry.day2Sent || 0) + (entry.day7Sent || 0);
  }
  return total;
}

/** Daily cap (emails per UTC day). */
export const DAILY_SEND_CAP = 50;


/**
 * INBOUND-HEALTH-V1: last inbound-poll runs. Same fail-closed contract as
 * getCronStatus — returns an empty history only when nothing was ever
 * recorded, throws if the read failed.
 */
export async function getInboundStatus(): Promise<InboundStatus> {
  const data = await readStored<InboundStatus>('the inbound poll history', () =>
    statusStore().get(INBOUND_KEY, { type: 'json' })
  );
  return data ?? { history: [] };
}

export async function recordInboundRun(record: InboundRunRecord): Promise<void> {
  const store = statusStore();
  let current: InboundStatus;
  try {
    current = await getInboundStatus();
  } catch (err) {
    // Same reasoning as recordCronRun: losing one record beats writing a
    // single-entry history over the rest, and this runs after the work.
    if (isStoreReadError(err)) {
      console.error(
        '[cron-status] inbound history unreadable — skipping the run record. Run was:',
        JSON.stringify(record)
      );
      return;
    }
    throw err;
  }
  const next: InboundStatus = {
    lastRun: record,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  };
  await store.setJSON(INBOUND_KEY, next as any);
}
