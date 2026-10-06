import type { T } from './harness';
import { runOutcomeNotification } from '@/lib/autogen-notify';

const base = { ok: true, createdCount: 0, skippedCount: 0, errorCount: 0 } as any;
const D = '2026-10-06';

export async function run(t: T) {
  t.group('a scheduled run that tried and produced nothing reaches the bell');
  {
    const n = runOutcomeNotification({
      ...base, errorCount: 42,
      captionErrors: ['HTTP 400: Your credit balance is too low to access the Anthropic API.'],
    }, D);
    t.ok('fires', n !== null);
    t.is('type', n?.type, 'social_autogen_failed');
    t.is('title', n?.title, 'Auto-fill created nothing');
    t.is('body names the count and the cause', n?.body,
      '42 slots failed: HTTP 400: Your credit balance is too low to access the Anthropic API.');
    t.ok('dedupe key stays bounded', (n?.dedupeKey.length || 0) <= `social-autogen-failed-${D}-`.length + 60);
  }

  t.group('silent where it must be — a run with nothing to do');
  for (const reason of ['calendar-full', 'no-accounts', 'no-briefs', 'no-posting-times', 'no-themes']) {
    t.is(reason, runOutcomeNotification({ ...base, emptyReason: reason }, D), null);
  }
  t.is('empty plan with skipped slots',
    runOutcomeNotification({ ...base, skippedCount: 40, emptyReason: 'calendar-full' }, D), null);

  t.group('success is unchanged');
  {
    t.is('body', runOutcomeNotification({ ...base, createdCount: 6, details: [{}, {}] }, D)?.body,
      'Created 6 drafts across 2 accounts.');
    t.is('dedupe key', runOutcomeNotification({ ...base, createdCount: 1, details: [{}] }, D)?.dedupeKey,
      'social-autogen-' + D);
    t.is('singulars', runOutcomeNotification({ ...base, createdCount: 1, details: [{}] }, D)?.body,
      'Created 1 draft across 1 account.');
    t.is('partial success does not warn',
      runOutcomeNotification({ ...base, createdCount: 3, errorCount: 5 }, D)?.type, 'social_drafted');
  }

  t.group('other failure shapes');
  {
    t.is('the run threw',
      runOutcomeNotification({ ...base, ok: false, errorCount: 1, error: 'Could not re-read social_posts before saving' }, D)?.body,
      '1 slot failed: Could not re-read social_posts before saving');
    t.is('starved', runOutcomeNotification({ ...base, noRoomForBatch: true }, D)?.body,
      '0 slots failed: the run ran out of time before it could start writing');
    t.is('failed with no reason', runOutcomeNotification({ ...base, errorCount: 7 }, D)?.body,
      '7 slots failed: no reason reported — check the function logs');
  }

  t.group('de-dupe: the same problem collapses, a new one gets through');
  {
    const k = (errs: string[], day = D) =>
      runOutcomeNotification({ ...base, errorCount: 42, captionErrors: errs }, day)?.dedupeKey;
    t.ok('same reason, same key', k(['credit balance too low']) === k(['credit balance too low']));
    t.ok('new reason, new key', k(['credit balance too low']) !== k(['HTTP 429: rate limited']));
    t.ok('next day, new key', k(['credit balance too low']) !== k(['credit balance too low'], '2026-10-07'));
  }
}
