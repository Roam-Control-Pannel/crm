import { NextRequest, NextResponse } from 'next/server';
import { safeEqual } from '@/lib/safe-equal';
import { getBatch, fetchBatchResults } from '@/lib/anthropic-batch';
import {
  readJobs,
  writeJobs,
  isActive,
  postsFromResults,
  statusFromOutcome,
  type FillJob,
} from '@/lib/fill-job';
import { addNotification } from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * FILL-BATCH-V1
 *
 * POST /api/social/fill-poll — check every in-flight fill job, and for any
 * whose batch has ended, write its captions into the calendar.
 *
 * Driven by netlify/functions/social-fill-poll.mts every 2 minutes. The
 * cadence matters less than it does for publishing: a batch takes minutes to
 * an hour, so a couple of minutes of collection lag is nothing.
 *
 * Auth: bearer-equivalent x-internal-call only. Nothing here should be
 * reachable from a browser — it writes posts.
 */

/** One job's ingest can involve a large results file; bound the whole run. */
const RUN_BUDGET_MS = 20_000;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET_V2 not configured' }, { status: 500 });
  }
  const provided = req.headers.get('x-internal-call');
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 });
  }

  const startedAt = Date.now();
  const origin = new URL(req.url).origin;
  const headers = { 'Content-Type': 'application/json', 'x-internal-call': secret };

  let jobs: FillJob[];
  try {
    jobs = await readJobs();
  } catch (err: any) {
    // FAIL-CLOSED-READS-V1: without the job list there is nothing to poll,
    // and writing anything now would drop in-flight jobs.
    console.error('[fill-poll] could not read jobs:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Could not read fill jobs' }, { status: 503 });
  }

  const active = jobs.filter(isActive);
  if (active.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, ingested: 0 });
  }

  let ingested = 0;
  let totalCreated = 0;
  const report: Array<{ id: string; status: string; created?: number; error?: string }> = [];

  for (const job of active) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) break;
    try {
      const batch = await getBatch(apiKey, job.batchId);

      if (batch.processing_status !== 'ended') {
        // Anthropic expires a batch at 24 hours. Past that it will never end,
        // so stop polling it rather than checking forever.
        const expiry = job.expiresAt ? Date.parse(job.expiresAt) : NaN;
        if (Number.isFinite(expiry) && Date.now() > expiry) {
          job.status = 'expired';
          job.error = 'The batch did not finish within its 24-hour window.';
          job.updatedAt = new Date().toISOString();
          report.push({ id: job.id, status: 'expired' });
        } else {
          report.push({ id: job.id, status: 'waiting' });
        }
        continue;
      }

      if (!batch.results_url) {
        job.status = 'failed';
        job.error = 'The batch ended but returned no results URL.';
        job.updatedAt = new Date().toISOString();
        report.push({ id: job.id, status: 'failed', error: job.error });
        continue;
      }

      const results = await fetchBatchResults(apiKey, batch.results_url);

      // Read the calendar as it stands NOW, not as it stood at submit time.
      // This is both the dedup source and the merge base: the publish-due
      // cron fires every 2 minutes, and writing from a stale snapshot is
      // exactly the double-publish AUTOGEN-MERGE-ON-WRITE-V1 exists to stop.
      const freshRes = await fetch(`${origin}/api/store/social_posts`, { headers, cache: 'no-store' });
      if (!freshRes.ok) throw new Error(`Could not read social_posts: ${freshRes.status}`);
      const fresh = await freshRes.json();
      const existing: any[] = Array.isArray(fresh?.data) ? fresh.data : [];

      const outcome = postsFromResults(job, results, existing);

      if (outcome.posts.length > 0) {
        const existingIds = new Set(existing.map((p: any) => p.id));
        const all = [...existing, ...outcome.posts.filter(p => !existingIds.has(p.id))];
        const saveRes = await fetch(`${origin}/api/store/social_posts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ data: all }),
        });
        if (!saveRes.ok) throw new Error(`Save failed: ${saveRes.status}`);
      }

      job.counts = {
        requested: job.slots.length,
        created: outcome.created,
        failed: outcome.failed,
        skipped: outcome.skipped,
      };
      job.status = statusFromOutcome(outcome, job.slots.length);
      job.updatedAt = new Date().toISOString();
      ingested += 1;
      totalCreated += outcome.created;
      report.push({ id: job.id, status: job.status, created: outcome.created });
    } catch (err: any) {
      // Leave the job active: a transient read failure should be retried on
      // the next tick, not turned into a permanent failure that strands the
      // captions we have already paid for.
      console.error(`[fill-poll] job ${job.id} failed this tick:`, err);
      report.push({ id: job.id, status: 'retry', error: err?.message });
    }
  }

  try {
    await writeJobs(jobs);
  } catch (err) {
    console.error('[fill-poll] could not persist job state:', err);
  }

  if (totalCreated > 0) {
    await addNotification({
      type: 'social_drafted',
      title: 'Calendar filled',
      body: `${totalCreated} draft${totalCreated === 1 ? '' : 's'} written in the background.`,
      href: '/social',
      dedupeKey: 'social-fill-batch-' + new Date().toISOString().slice(0, 13),
    });
  }

  return NextResponse.json({ ok: true, checked: active.length, ingested, created: totalCreated, report });
}
