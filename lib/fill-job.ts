/**
 * FILL-JOB-V1
 *
 * The record of a batched calendar fill: which slots were planned, which
 * photo each one was given, and the Anthropic batch that is writing their
 * captions.
 *
 * Why the slots are stored rather than re-planned on ingest: a batch comes
 * back minutes or hours later, and by then the calendar has moved. Re-running
 * the planner would hand result N to a different slot than the one whose
 * prompt produced it — the caption would describe a photo the post does not
 * carry. The plan is therefore frozen at submit time and the batch's
 * custom_id is the only link that matters.
 */

import { getStore } from '@netlify/blobs';
import { readStored } from '@/lib/store-read';

const STORE_NAME = 'roam-system';
const KEY = 'social-fill-jobs';

/**
 * How many finished jobs to keep. Enough to show recent history in the UI
 * and to diagnose a bad run; not so many that the blob grows without bound,
 * since each job carries one row per planned slot.
 */
export const MAX_RETAINED_JOBS = 20;

export type FillJobStatus =
  /** Submitted to Anthropic; waiting for the batch to end. */
  | 'submitted'
  /** Every slot that could be written was written. */
  | 'done'
  /** Some slots produced no caption. The rest were still saved. */
  | 'partial'
  /** The batch could not be submitted or could not be read back. */
  | 'failed'
  /** The batch hit its 24-hour ceiling before finishing. */
  | 'expired';

/** Everything needed to turn one batch result back into a post. */
export interface FillJobSlot {
  customId: string;
  accountId: string;
  briefId: string;
  themeId: string;
  scheduledAt: string;
  imageUrl?: string;
  imageCredit?: string;
  imageCreditUrl?: string;
  imagePhotoUrl?: string;
  imageUnsplashUrl?: string;
  imageSocialHandles?: { instagram?: string | null; twitter?: string | null; unsplash?: string | null };
}

export interface FillJob {
  id: string;
  batchId: string;
  status: FillJobStatus;
  createdAt: string;
  updatedAt: string;
  /** Anthropic's own expiry for the batch — after this it will never finish. */
  expiresAt?: string;
  slots: FillJobSlot[];
  counts: { requested: number; created: number; failed: number; skipped: number };
  error?: string;
}

export function isActive(job: FillJob): boolean {
  return job.status === 'submitted';
}

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

/**
 * FAIL-CLOSED-READS-V1: this store is read-modify-write, so a read failure
 * that looked like "no jobs" would let the next write drop every job —
 * including an in-flight one, stranding its batch with nothing to ingest it.
 */
export async function readJobs(): Promise<FillJob[]> {
  const data = await readStored<FillJob[]>('the social fill jobs', () =>
    store().get(KEY, { type: 'json' })
  );
  return Array.isArray(data) ? data : [];
}

export async function writeJobs(jobs: FillJob[]): Promise<void> {
  // Newest first, capped. Active jobs are never dropped by the cap: losing
  // one would leave its batch running with nothing to collect the results.
  const sorted = [...jobs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const active = sorted.filter(isActive);
  const finished = sorted.filter(j => !isActive(j)).slice(0, MAX_RETAINED_JOBS);
  await store().setJSON(KEY, [...active, ...finished] as any);
}

/** Read, apply, write. The whole store is one small blob, so this is enough. */
export async function updateJob(
  id: string,
  apply: (job: FillJob) => FillJob
): Promise<FillJob | null> {
  const jobs = await readJobs();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx === -1) return null;
  const next = apply(jobs[idx]);
  next.updatedAt = new Date().toISOString();
  jobs[idx] = next;
  await writeJobs(jobs);
  return next;
}

// ---------------------------------------------------------------------------
// Turning results back into posts
// ---------------------------------------------------------------------------

/** Minimum post shape this module needs to build and to dedup against. */
export interface IngestPost {
  id: string;
  briefId?: string;
  themeId?: string;
  accountIds: string[];
  caption: string;
  imageUrl?: string;
  imageCredit?: string;
  imageCreditUrl?: string;
  imagePhotoUrl?: string;
  imageUnsplashUrl?: string;
  imageSocialHandles?: FillJobSlot['imageSocialHandles'];
  scheduledAt: string;
  status: 'draft';
  createdAt: string;
}

export interface IngestOutcome {
  posts: IngestPost[];
  created: number;
  /** Results that carried no usable caption. */
  failed: number;
  /** Slots whose calendar position was taken while the batch ran. */
  skipped: number;
}

/**
 * Build the posts for a finished batch.
 *
 * `existing` is the calendar as it stands NOW, not as it stood at submit
 * time. A batch can take an hour, and in that window the synchronous fill,
 * Roam-io, or a person may have filled the same slot. Writing anyway would
 * put two posts on one account at one time, which the publisher would send
 * as two posts — so a taken slot is skipped, not overwritten.
 *
 * Pure, so the whole ingest can be tested without a live batch.
 */
export function postsFromResults(
  job: FillJob,
  results: Array<{ customId: string; type: string; text?: string }>,
  existing: Array<{ accountIds?: string[]; scheduledAt?: string }>,
  now: Date = new Date()
): IngestOutcome {
  const bySlot = new Map(job.slots.map(s => [s.customId, s]));
  const taken = new Set(
    existing.flatMap(p => (p.accountIds || []).map(a => a + '|' + (p.scheduledAt || '')))
  );

  const posts: IngestPost[] = [];
  let created = 0, failed = 0, skipped = 0;
  let seq = 0;

  for (const result of results) {
    const slot = bySlot.get(result.customId);
    // A result for a slot this job never planned cannot be placed anywhere.
    if (!slot) { failed += 1; continue; }

    const caption = (result.type === 'succeeded' ? result.text || '' : '').trim();
    if (!caption) { failed += 1; continue; }

    const key = slot.accountId + '|' + slot.scheduledAt;
    if (taken.has(key)) { skipped += 1; continue; }
    // Guard against two results mapping to one slot as well as against the
    // calendar: both end as a duplicate post if unchecked.
    taken.add(key);

    posts.push({
      id: 'p' + now.getTime().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6),
      briefId: slot.briefId,
      themeId: slot.themeId,
      accountIds: [slot.accountId],
      caption,
      imageUrl: slot.imageUrl,
      imageCredit: slot.imageCredit,
      imageCreditUrl: slot.imageCreditUrl,
      imagePhotoUrl: slot.imagePhotoUrl,
      imageUnsplashUrl: slot.imageUnsplashUrl,
      imageSocialHandles: slot.imageSocialHandles,
      scheduledAt: slot.scheduledAt,
      status: 'draft',
      createdAt: now.toISOString(),
    });
    created += 1;
  }

  return { posts, created, failed, skipped };
}

/** Final status for a job whose results have been applied. */
export function statusFromOutcome(outcome: IngestOutcome, requested: number): FillJobStatus {
  if (outcome.created === 0) return 'failed';
  if (outcome.created + outcome.skipped < requested) return 'partial';
  return 'done';
}
