// AUTOGEN-FAILURE-NOTIFS-V1
//
// What the bell should say about an auto-generate run, as a pure decision.
//
// Success was already announced; failure was not, and that was the gap. The
// scheduled fill can plan slots, reach every one of them and write nothing —
// an exhausted API balance does exactly this — and the only record was a
// console.error in the function logs. The calendar simply stayed empty, night
// after night, with nothing anywhere saying why. Someone who never clicks
// "Fill calendar" by hand had no way to find out.
//
// Silence is reserved for the one case that deserves it: a run with nothing
// to do. An empty plan is not a failure — no free slots, no active brief, no
// connected account — and notifying on it would fire every night forever on a
// calendar that is simply full.
//
// This lives apart from lib/social-cron.ts so the rule can be read and
// exercised without dragging @netlify/blobs in behind it — the same split as
// lib/social-cron-types.ts and lib/graphic-formats.ts.

import type { NotificationType } from './notification-types';
import type { AutoGenerateRunResult } from './social-cron-types';

export interface OutcomeNotification {
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  dedupeKey: string;
}

/**
 * The notification for this run, or null if the run warrants none.
 *
 * `day` is the ISO date the run happened on; it scopes the de-dupe window so
 * a nightly cron announces itself once a day rather than once an invocation.
 */
export function runOutcomeNotification(
  result: AutoGenerateRunResult,
  day: string
): OutcomeNotification | null {
  if (result.createdCount > 0) {
    const accounts = result.details?.length || 0;
    return {
      type: 'social_drafted',
      title: 'Auto-generated drafts',
      body: `Created ${result.createdCount} draft${result.createdCount === 1 ? '' : 's'} `
        + `across ${accounts} account${accounts === 1 ? '' : 's'}.`,
      href: '/social',
      dedupeKey: 'social-autogen-' + day,
    };
  }

  // The run threw outright, or it planned slots, reached them and could not
  // write any. Both are failures the user has to know about. A run that
  // planned nothing (emptyReason set, errorCount 0) is not.
  const attemptedAndFailed = (result.errorCount || 0) > 0 || Boolean(result.noRoomForBatch);
  if (!attemptedAndFailed) return null;

  const reason = result.error
    || result.captionErrors?.[0]
    || (result.noRoomForBatch
      ? 'the run ran out of time before it could start writing'
      : 'no reason reported — check the function logs');

  const failed = result.errorCount || 0;
  return {
    type: 'social_autogen_failed',
    title: 'Auto-fill created nothing',
    body: `${failed} slot${failed === 1 ? '' : 's'} failed: ${reason}`,
    href: '/social',
    // Keyed on the reason as well as the day, so a repeat of the same problem
    // stays quiet for the de-dupe window while a NEW problem still gets
    // through. Truncated because the key is stored and compared verbatim and
    // an upstream error body has no length bound.
    dedupeKey: `social-autogen-failed-${day}-${reason.slice(0, 60)}`,
  };
}
