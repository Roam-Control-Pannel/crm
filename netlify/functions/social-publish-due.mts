import type { Config } from '@netlify/functions';

/**
 * SCHEDULED-FETCH-TIMEOUT-V1
 *
 * A scheduled function whose fetch has no signal can sit on an unresponsive
 * app until the platform kills it, which logs as a generic invocation failure
 * with no indication of what stalled. 25s leaves room for the wrapper to
 * report the timeout itself before Netlify's own limit lands.
 */
const WRAPPER_TIMEOUT_MS = 25_000;


/**
 * CRON-PUBLISH-V1
 *
 * Scheduled function: every 2 minutes, hit /api/social/publish-due so any
 * social post whose scheduledAt has arrived gets published with no more
 * than ~2 minutes of jitter.
 *
 * Pattern mirrors inbound-poll.mts and sequences-daily.mts — the secret
 * lives only on the server, never in this function or the browser. The
 * function itself is deliberately thin: it forwards the call with a
 * Bearer-equivalent header (`x-internal-call`) and the Next.js route
 * does all the real work.
 *
 * Cadence: 2 minutes. An earlier version used an every-minute schedule,
 * but that sits at Netlify's practical minimum and the scheduler silently
 * declined to register/fire it — the function showed as "Scheduled" in the
 * UI but never ran, so scheduled posts stayed stuck at status 'scheduled'
 * and never published. The two sibling crons that DO fire reliably
 * (inbound-poll every 15 minutes, sequences-daily at 08:00) both use
 * multi-minute intervals, which is the only thing that differed. A
 * 2-minute cadence keeps the worst-case delay from scheduledAt to publish
 * at ~2 minutes while staying safely clear of the every-minute edge case.
 * Tighter timing would require platform-native scheduling (mixed support
 * across LinkedIn/FB/IG) or a separate job queue.
 */

export default async () => {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    console.error('[scheduled:social-publish-due] CRON_SECRET_V2 not set; aborting.');
    return new Response('Missing secret', { status: 500 });
  }

  const url = process.env.URL
    ? `${process.env.URL}/api/social/publish-due`
    : 'https://roam-crm-platform.netlify.app/api/social/publish-due';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-internal-call': secret },
      signal: AbortSignal.timeout(WRAPPER_TIMEOUT_MS),
    });
    const body = await res.text();
    // CRON-REPORTING-V1: res.ok covers 200-299, so a 207 (some accounts
    // failed) used to log as a clean run. Inspect the payload, not just the
    // status — an expired LinkedIn refresh token fails every account while
    // the request itself succeeds perfectly.
    if (!res.ok) {
      console.error(`[scheduled:social-publish-due] failed ${res.status}: ${body.slice(0, 500)}`);
    } else {
      let failedAccounts = 0;
      try { failedAccounts = JSON.parse(body)?.failedAccounts ?? 0; } catch { /* non-JSON, logged below */ }
      if (res.status === 207 || failedAccounts > 0) {
        console.error(
          `[scheduled:social-publish-due] DEGRADED (${res.status}), ${failedAccounts} account publish(es) failed: ${body.slice(0, 500)}`
        );
      } else {
        console.log(`[scheduled:social-publish-due] ok: ${body.slice(0, 500)}`);
      }
    }
    return new Response(body, { status: res.status });
  } catch (err) {
    console.error('[scheduled:social-publish-due] threw:', err);
    return new Response(String(err), { status: 500 });
  }
};

export const config: Config = {
  // Must stay in sync with netlify.toml [functions."social-publish-due"].
  // Every-minute ('* * * * *') is deliberately avoided — see the cadence note
  // above: Netlify silently declined to register it and the job never fired,
  // stranding scheduled posts in status 'scheduled'.
  schedule: '*/2 * * * *',
};
