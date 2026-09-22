import type { Config } from '@netlify/functions';

/**
 * SCHEDULED-FETCH-TIMEOUT-V1
 * A scheduled function whose fetch has no signal can sit on an unresponsive
 * app until the platform kills it, logging as a generic invocation failure
 * with no indication of what stalled.
 */
const WRAPPER_TIMEOUT_MS = 25_000;

/**
 * FILL-BATCH-V1
 *
 * Scheduled function: every 2 minutes, hit /api/social/fill-poll so any
 * finished Message Batch gets turned into calendar drafts.
 *
 * Same thin-wrapper pattern as social-publish-due.mts — the secret lives
 * only on the server and the Next.js route does the work.
 *
 * Cadence: 2 minutes, matching the sibling that is known to register
 * reliably on this site. It is not a latency requirement — a batch takes
 * minutes to an hour, so a couple of minutes of collection lag is nothing —
 * it is simply the cheapest cadence already proven to fire here. Netlify
 * silently declined to register an every-minute schedule in the past, which
 * is why nothing in this repo uses one.
 *
 * The route is a no-op when there are no in-flight jobs, which is most of
 * the time: it reads one small blob and returns.
 */
export default async () => {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    console.error('[scheduled:social-fill-poll] CRON_SECRET_V2 not set; aborting.');
    return new Response('Missing secret', { status: 500 });
  }

  const url = process.env.URL
    ? `${process.env.URL}/api/social/fill-poll`
    : 'https://roam-crm-platform.netlify.app/api/social/fill-poll';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-internal-call': secret },
      signal: AbortSignal.timeout(WRAPPER_TIMEOUT_MS),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[scheduled:social-fill-poll] failed ${res.status}: ${body.slice(0, 500)}`);
    } else {
      // CRON-REPORTING-V1: a 200 with a job stuck in 'retry' is not a clean
      // run, so inspect the payload rather than trusting the status code.
      let retries = 0;
      try {
        const data = JSON.parse(body);
        retries = (data?.report || []).filter((r: any) => r?.status === 'retry').length;
      } catch { /* non-JSON, logged below */ }
      if (retries > 0) {
        console.error(`[scheduled:social-fill-poll] ${retries} job(s) errored this tick: ${body.slice(0, 500)}`);
      } else {
        console.log(`[scheduled:social-fill-poll] ok: ${body.slice(0, 300)}`);
      }
    }
    return new Response(body, { status: res.status });
  } catch (err) {
    console.error('[scheduled:social-fill-poll] threw:', err);
    return new Response(String(err), { status: 500 });
  }
};

export const config: Config = {
  // Must stay in sync with netlify.toml [functions."social-fill-poll"].
  schedule: '*/2 * * * *',
};
