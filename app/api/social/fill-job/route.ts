import { NextRequest, NextResponse } from 'next/server';
import { submitFillBatch, MAX_SLOTS_PER_JOB } from '@/lib/fill-batch';
import { readJobs } from '@/lib/fill-job';
import { readErrorResponse } from '@/lib/store-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * FILL-BATCH-V1
 *
 * POST /api/social/fill-job   — plan the whole fill and submit it as one
 *                               Anthropic Message Batch. Returns immediately.
 * GET  /api/social/fill-job   — the recent jobs, newest first.
 *
 * Auth: not in middleware's PUBLIC_API_ROUTES, so a session or the
 * x-internal-call secret is required. The Fill-in-background button calls it
 * from a signed-in page; nothing else calls it yet.
 *
 * Submitting is idempotent in the way that matters: a slot already holding a
 * post is never planned again (the dedup in planFill), and a slot filled
 * while the batch runs is skipped at ingest. Submitting twice therefore
 * wastes tokens but cannot double-post.
 */

export async function GET() {
  try {
    const jobs = await readJobs();
    return NextResponse.json({ ok: true, jobs });
  } catch (err) {
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET_V2 not configured' }, { status: 500 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 });
  }

  let lookaheadDaysOverride: number | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.lookaheadDays === 'number' && body.lookaheadDays > 0) {
      lookaheadDaysOverride = body.lookaheadDays;
    }
  } catch { /* no body is fine — use the configured lookahead */ }

  try {
    const result = await submitFillBatch(
      { origin: new URL(req.url).origin, internalSecret: secret, lookaheadDaysOverride },
      apiKey
    );
    if (result.nothingToDo) {
      return NextResponse.json({
        ok: true,
        nothingToDo: true,
        message: 'Every slot in the window already has a post.',
      });
    }
    return NextResponse.json({
      ok: true,
      job: result.job,
      plannedSlots: result.plannedSlots,
      // Tell the caller when the plan was larger than one job can hold, so
      // the UI can say "run it again" rather than silently leaving a gap.
      truncated: (result.plannedSlots || 0) > MAX_SLOTS_PER_JOB,
    });
  } catch (err: any) {
    console.error('[social/fill-job] submit failed:', err);
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
