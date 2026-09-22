// FILL-DIAGNOSIS-V2
//
// The decision logic behind the "Fill calendar" button, as pure functions.
//
// The button drives a loop: call /api/social/auto-generate/run-now, look at
// what came back, decide whether to go round again, and when it stops, tell
// the user why. That decision used to live inline in the click handler and
// got it wrong twice, in the same way both times — a terminal branch that
// ran before the branch holding the diagnosis, so the run ended with no
// reason recorded and the fallback message spoke for it. The fallback was
// "Calendar is full", which is how the button came to say that about an
// empty calendar.
//
// Pulling it out here is not decoration. The rules are subtle enough to need
// stating once, in one place, where they can be read end to end:
//
//   * A round that creates nothing is NOT automatically a failure. An empty
//     plan (no accounts, no briefs, no free slots) also creates nothing, and
//     that is a normal outcome with its own message.
//   * `errorCount` is the honest "we tried and could not" signal: the server
//     increments it once per slot it planned, reached, and failed to write.
//   * `noRoomForBatch` means it never reached a single slot — a time problem,
//     not a generation problem, and the two need different things from the
//     user.
//   * `emptyReason` is set if and only if the server planned no slots at all.
//     Its absence therefore means the plan was NOT empty, which is the one
//     case where "Calendar is full" must not be the default.

/** The fields of AutoGenerateResult this loop actually reads. */
export interface FillRoundData {
  createdCount?: number;
  skippedCount?: number;
  errorCount?: number;
  pendingCount?: number;
  stoppedEarly?: boolean;
  noRoomForBatch?: boolean;
  emptyReason?: string;
  captionErrors?: string[];
}

/** Running totals the loop carries across rounds. */
export interface FillTotals {
  totalCreated: number;
  totalSkipped: number;
  totalErrors: number;
  pendingLeft: number;
  lastEmptyReason: string | null;
  /** Distinct caption failures, in first-seen order, across every round. */
  captionErrors: string[];
}

export function emptyFillTotals(): FillTotals {
  return {
    totalCreated: 0,
    totalSkipped: 0,
    totalErrors: 0,
    pendingLeft: 0,
    lastEmptyReason: null,
    captionErrors: [],
  };
}

/**
 * Fold one round's response into the running totals, in place.
 *
 * Note the asymmetry: created slots and failed slots accumulate, but
 * `skippedCount` is a fresh count of already-filled slots every round, so it
 * is replaced rather than summed.
 */
export function accumulateRound(totals: FillTotals, data: FillRoundData): void {
  totals.totalCreated += data.createdCount || 0;
  totals.totalSkipped = data.skippedCount || 0;
  totals.totalErrors += data.errorCount || 0;
  totals.pendingLeft = data.pendingCount || 0;
  totals.lastEmptyReason = data.emptyReason || null;
  if (Array.isArray(data.captionErrors)) {
    for (const why of data.captionErrors) {
      if (typeof why === 'string' && why && !totals.captionErrors.includes(why)) {
        totals.captionErrors.push(why);
      }
    }
  }
}

/**
 * Why this round failed, or null if it did not fail.
 *
 * Called BEFORE the continue/stop decision, because a round can fail while
 * still reporting that it reached the end of its slot list — every caption
 * failing looks exactly like a completed run from the outside.
 */
export function diagnoseRound(data: FillRoundData, totals: FillTotals): string | null {
  if (data.createdCount) return null;
  // An empty plan creates nothing too. Only a round that says it tried —
  // attempted-and-failed slots, or no room to attempt any — is a failure.
  if (!data.errorCount && !data.noRoomForBatch) return null;

  if (data.noRoomForBatch) {
    return 'the server ran out of time before it could start writing. '
      + 'This usually means a slow read of the calendar or the Brain — '
      + 'try again, and if it keeps happening the lookahead window is too large.';
  }
  if (totals.captionErrors.length > 0) {
    return `the AI could not write them.\n\n${totals.captionErrors.map(e => '• ' + e).join('\n')}`;
  }
  return 'generation failed, and the server reported no reason — check the function logs.';
}

/**
 * Should the loop go round again? Only when the server stopped short of its
 * own plan AND still has slots queued.
 */
export function shouldContinue(data: FillRoundData): boolean {
  return Boolean(data.stoppedEarly && (data.pendingCount || 0) > 0);
}

const EMPTY_PLAN_REASONS: Record<string, string> = {
  'no-accounts': 'No connected account can publish right now — check Channels.',
  'no-briefs': 'No account has an active brief assigned — check Social Accounts.',
  'no-posting-times': 'No posting times fall inside the window — check Settings.',
  'no-themes': 'No enabled theme matches the assigned briefs — check Settings.',
  'calendar-full': 'Calendar is full.',
};

/** "Created 3 drafts (skipped 12 already-filled slots, 4 failed)." */
export function fillSummary(totals: FillTotals): string {
  const { totalCreated, totalSkipped, totalErrors } = totals;
  return `Created ${totalCreated} draft${totalCreated === 1 ? '' : 's'}`
    + ` (skipped ${totalSkipped} already-filled slot${totalSkipped === 1 ? '' : 's'}`
    + (totalErrors > 0 ? `, ${totalErrors} failed` : '')
    + ').';
}

/** The whole message the user sees when the loop stops. */
export function fillOutcomeMessage(totals: FillTotals, loopError: string | null): string {
  const summary = fillSummary(totals);

  if (loopError) {
    // A run that reached every slot and failed reports no pendingCount, so
    // fall back to the attempted-and-failed count rather than "Some slots".
    const unfilled = totals.pendingLeft || totals.totalErrors;
    return `${summary}\n\n${unfilled || 'Some'} slot${unfilled === 1 ? '' : 's'}`
      + ` could not be filled: ${loopError}`;
  }

  if (totals.pendingLeft > 0) {
    // Hit the round cap with slots remaining — rare, but don't claim the
    // calendar is full when it isn't.
    return `${summary} ${totals.pendingLeft} slot${totals.pendingLeft === 1 ? '' : 's'}`
      + ' left — click Fill calendar again to continue.';
  }

  if (totals.lastEmptyReason) {
    return `${summary} ${EMPTY_PLAN_REASONS[totals.lastEmptyReason]
      || `The engine stopped: ${totals.lastEmptyReason}.`}`;
  }

  // No emptyReason means the server planned slots and worked through them, so
  // "Calendar is full" is only true if it actually wrote something. Claiming
  // it for an unexplained empty run is how this button told the user a blank
  // calendar was full.
  return `${summary} ${totals.totalCreated > 0
    ? 'Calendar is full.'
    : 'Nothing was created and the server did not say why — check the function logs.'}`;
}
