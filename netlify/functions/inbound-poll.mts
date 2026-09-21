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
 * Scheduled function: every 15 minutes, hit the inbound poll endpoint.
 *
 * Mirrors the pattern in netlify/functions/sequences-daily.mts — the secret
 * lives only on the server, never in the function code or the browser.
 *
 * The function itself is deliberately thin: it fetches the public, bearer-
 * gated /api/inbound/poll endpoint and returns. All real work happens there.
 */
export default async (_req: Request) => {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    console.error('[inbound-poll] CRON_SECRET_V2 not configured');
    return new Response('Missing secret', { status: 500 });
  }

  const url = process.env.URL
    ? `${process.env.URL}/api/inbound/poll`
    : 'https://roam-crm-platform.netlify.app/api/inbound/poll';

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(WRAPPER_TIMEOUT_MS),
    });
    const body = await res.text();
    // CRON-REPORTING-V1: distinguish a clean run from one where replies
    // failed to process. This used to log every outcome at the same level.
    let errors = 0;
    try { errors = JSON.parse(body)?.errors ?? 0; } catch { /* non-JSON */ }
    if (!res.ok || res.status === 207 || errors > 0) {
      console.error(`[inbound-poll] DEGRADED ${res.status} (${errors} error(s)): ${body.slice(0, 500)}`);
    } else {
      console.log(`[inbound-poll] ok ${res.status}: ${body.slice(0, 500)}`);
    }
    return new Response(body, { status: res.status });
  } catch (err: any) {
    console.error('[inbound-poll] fetch failed:', err?.message);
    return new Response(err?.message || 'Failed', { status: 500 });
  }
};

export const config: Config = {
  schedule: '*/15 * * * *', // every 15 minutes
};
