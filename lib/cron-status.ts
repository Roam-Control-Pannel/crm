import { getStore } from '@netlify/blobs';
import { readStored, isStoreReadError } from './store-read';
import { mutateBlob } from './blob-cas';

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
  // BLOB-CAS-V1: two runs finishing close together (the Netlify cron and the
  // GitHub backup) each read the history and wrote their own entry over it,
  // so one of the two records vanished — from the very log used to tell
  // whether a run happened.
  try {
    await mutateBlob<CronStatus>(
      store,
      KEY,
      live => ({
        lastRun: record,
        history: [record, ...(live?.history || current.history)].slice(0, HISTORY_LIMIT),
      }),
      { what: 'the cron run history' }
    );
  } catch (err) {
    // Same reasoning as the read above: this runs after the emails have gone
    // out, and a throw here would replace the caller's real outcome.
    console.error(
      '[cron-status] could not record the run — outcome was:',
      JSON.stringify(record),
      err
    );
  }
}

/**
 * Claim the daily scheduled sequences run for `dateStr` (YYYY-MM-DD).
 *
 * Returns true if THIS caller acquired the claim, false if someone else holds
 * it. A redundant trigger (the GitHub Actions backup) then runs the day's
 * sequences only when the primary Netlify cron did not, without risk of
 * double-emailing.
 *
 * DAILY-CLAIM-RELEASE-V1
 *
 * Two things were wrong with the previous version.
 *
 * First, it was read-then-write with nothing binding the two, so two
 * simultaneous callers could both read "unclaimed" and both proceed. That is
 * now a conditional write: exactly one caller can turn an unclaimed day into
 * a claimed one.
 *
 * Second, and worse, there was no way out of a claim. The sequences loop walks
 * 11k contacts with no wall-clock budget against a ~26s ceiling, so a run that
 * is killed mid-way leaves the day claimed with most of its follow-ups unsent.
 * Both backups then saw the claim, returned {success:true, skipped:true}, and
 * the workflow gate passed them green: the day's email silently did not go
 * out and nothing anywhere said so.
 *
 * So a claim now records whether it finished. An unfinished claim older than
 * STALE_CLAIM_MS can be taken over — which is what a backup trigger is for —
 * while a finished one is never re-run. The window is far longer than any run
 * can survive (the platform kills it at ~26s) and far shorter than the gap to
 * the first backup, so it cannot cause a double-send.
 */
const STALE_CLAIM_MS = 10 * 60 * 1000;

interface DailyClaim {
  date: string;
  claimedAt: string;
  completedAt?: string;
}

export async function claimDailyRun(dateStr: string): Promise<boolean> {
  const store = statusStore();
  let acquired = false;
  await mutateBlob<DailyClaim>(
    store,
    CLAIM_KEY,
    current => {
      const held =
        current?.date === dateStr &&
        (!!current.completedAt ||
          Date.now() - new Date(current.claimedAt).getTime() < STALE_CLAIM_MS);
      if (held) {
        acquired = false;
        return current as DailyClaim;
      }
      if (current?.date === dateStr && !current.completedAt) {
        console.warn(
          `[cron-status] taking over a stale claim for ${dateStr} (claimed ${current.claimedAt}, never completed)`
        );
      }
      acquired = true;
      return { date: dateStr, claimedAt: new Date().toISOString() };
    },
    { what: 'the daily run claim' }
  );
  return acquired;
}

/**
 * DAILY-CLAIM-RELEASE-V1: close out a claim this process acquired.
 *
 * `completed: true` marks the day done so no later trigger repeats it.
 * `completed: false` releases it, so a backup trigger can pick the day up —
 * used when the run threw and its follow-ups did not all go out.
 *
 * Never throws: it runs on the way out of a run whose emails have already
 * been sent, and the caller's own outcome matters more than this bookkeeping.
 */
export async function releaseDailyRun(dateStr: string, completed: boolean): Promise<void> {
  try {
    await mutateBlob<DailyClaim>(
      statusStore(),
      CLAIM_KEY,
      current => {
        // Only touch our own day: a later day's claim is not ours to clear.
        if (current?.date !== dateStr) return current as DailyClaim;
        return completed
          ? { ...current, completedAt: new Date().toISOString() }
          : { date: dateStr, claimedAt: new Date(0).toISOString() };
      },
      { what: 'the daily run claim' }
    );
  } catch (err) {
    console.error(`[cron-status] could not release the claim for ${dateStr}:`, err);
  }
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
  // BLOB-CAS-V1: same lost-update shape as recordCronRun above.
  try {
    await mutateBlob<InboundStatus>(
      store,
      INBOUND_KEY,
      live => ({
        lastRun: record,
        history: [record, ...(live?.history || current.history)].slice(0, HISTORY_LIMIT),
      }),
      { what: 'the inbound poll history' }
    );
  } catch (err) {
    console.error(
      '[cron-status] could not record the inbound run — run was:',
      JSON.stringify(record),
      err
    );
  }
}
