import { getStore } from '@netlify/blobs';

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

const STORE_NAME = 'roam-system';
const KEY = 'sequences-cron-status';
const HISTORY_LIMIT = 14;

function statusStore() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

export async function getCronStatus(): Promise<CronStatus> {
  try {
    const store = statusStore();
    const data = (await store.get(KEY, { type: 'json' })) as CronStatus | null;
    return data || { history: [] };
  } catch (err) {
    console.error('getCronStatus failed:', err);
    return { history: [] };
  }
}

export async function recordCronRun(record: CronRunRecord): Promise<void> {
  const store = statusStore();
  const current = await getCronStatus();
  const next: CronStatus = {
    lastRun: record,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  };
  await store.setJSON(KEY, next as any);
}

/**
 * Counts how many sends have happened so far today. Used by the cron to
 * enforce the 50/day send cap.
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
