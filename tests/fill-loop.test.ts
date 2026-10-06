import type { T } from './harness';
import {
  emptyFillTotals, accumulateRound, diagnoseRound, shouldContinue, fillOutcomeMessage,
} from '@/lib/fill-loop';

/** Drive the loop the way the Fill calendar button does. */
function runLoop(rounds: any[]) {
  const totals = emptyFillTotals();
  let loopError: string | null = null;
  for (const data of rounds) {
    accumulateRound(totals, data);
    loopError = diagnoseRound(data, totals);
    if (loopError) break;
    if (!shouldContinue(data)) { totals.pendingLeft = 0; break; }
  }
  return fillOutcomeMessage(totals, loopError);
}

/** The terminal branches in the order they ran before FILL-DIAGNOSIS-V2. */
function legacyLoop(rounds: any[]) {
  let created = 0, skipped = 0, pending = 0;
  let loopError: string | null = null, emptyReason: string | null = null;
  for (const d of rounds) {
    created += d.createdCount || 0;
    skipped = d.skippedCount || 0;
    pending = d.pendingCount || 0;
    emptyReason = d.emptyReason || null;
    if (!d.stoppedEarly || !pending) { pending = 0; break; }
    if (!d.createdCount) { loopError = 'stalled'; break; }
  }
  const summary = `Created ${created} draft${created === 1 ? '' : 's'} (skipped ${skipped} already-filled slot${skipped === 1 ? '' : 's'}).`;
  if (loopError) return `${summary} ${loopError}`;
  if (pending > 0) return `${summary} ${pending} left`;
  const reasons: Record<string, string> = { 'calendar-full': 'Calendar is full.' };
  return `${summary} ${reasons[emptyReason || 'calendar-full'] || 'Calendar is full.'}`;
}

export async function run(t: T) {
  t.group('every caption failed on a calendar that was empty');
  {
    const round = {
      ok: true, createdCount: 0, skippedCount: 0, errorCount: 12,
      captionErrors: ['HTTP 400: Your credit balance is too low to access the Anthropic API.'],
    };
    t.is('old behaviour: reported as a full calendar',
      legacyLoop([round]),
      'Created 0 drafts (skipped 0 already-filled slots). Calendar is full.');
    t.match('now names the upstream cause', runLoop([round]),
      /12 slots could not be filled: the AI could not write them[\s\S]*credit balance is too low/);
    t.ok('and never claims the calendar is full', !/Calendar is full/.test(runLoop([round])));
    t.match('counts the failures in the summary', runLoop([round]),
      /Created 0 drafts \(skipped 0 already-filled slots, 12 failed\)\./);
  }

  t.group('failures with no reason reported still say something honest');
  t.match('no captionErrors', runLoop([{ ok: true, createdCount: 0, errorCount: 3 }]),
    /3 slots could not be filled: generation failed, and the server reported no reason/);

  t.group('a genuinely full calendar still says so');
  {
    t.is('empty plan',
      runLoop([{ ok: true, createdCount: 0, skippedCount: 40, errorCount: 0, emptyReason: 'calendar-full' }]),
      'Created 0 drafts (skipped 40 already-filled slots). Calendar is full.');
    t.is('happy path with no emptyReason',
      runLoop([{ ok: true, createdCount: 8, skippedCount: 2, errorCount: 0 }]),
      'Created 8 drafts (skipped 2 already-filled slots). Calendar is full.');
  }

  t.group('the other empty-plan reasons survive');
  {
    t.match('no-briefs', runLoop([{ ok: true, createdCount: 0, errorCount: 0, emptyReason: 'no-briefs' }]),
      /No account has an active brief assigned/);
    t.match('no-accounts', runLoop([{ ok: true, createdCount: 0, errorCount: 0, emptyReason: 'no-accounts' }]),
      /No connected account can publish right now/);
  }

  t.group('starvation stays distinct from a generation failure');
  t.match('noRoomForBatch',
    runLoop([{ ok: true, createdCount: 0, errorCount: 0, noRoomForBatch: true, stoppedEarly: true, pendingCount: 42 }]),
    /42 slots could not be filled: the server ran out of time before it could start writing/);

  t.group('multi-round accumulation');
  t.match('totals add up and the first reason is kept', runLoop([
    { ok: true, createdCount: 4, skippedCount: 0, errorCount: 1, stoppedEarly: true, pendingCount: 20, captionErrors: ['rate limited'] },
    { ok: true, createdCount: 0, skippedCount: 4, errorCount: 20, captionErrors: ['rate limited', 'timed out'] },
  ]), /Created 4 drafts \(skipped 4 already-filled slots, 21 failed\)[\s\S]*• rate limited\n• timed out/);

  t.group('a normal mid-run stop invites another click');
  t.match('round cap with slots left', runLoop(
    Array.from({ length: 20 }, () => ({ ok: true, createdCount: 4, skippedCount: 0, errorCount: 0, stoppedEarly: true, pendingCount: 9 }))
  ), /Created 80 drafts \(skipped 0 already-filled slots\)\. 9 slots left — click Fill calendar again to continue\./);
}
