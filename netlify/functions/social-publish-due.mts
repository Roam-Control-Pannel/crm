import type { Config } from '@netlify/functions';

/**
 * CRON-PUBLISH-V1
 *
 * Scheduled function: every 5 minutes, hit /api/social/publish-due so any
 * social post whose scheduledAt has arrived gets published.
 *
 * Pattern mirrors inbound-poll.mts and sequences-daily.mts — the secret
 * lives only on the server, never in this function or the browser. The
 * function itself is deliberately thin: it forwards the call with a
 * Bearer-equivalent header (`x-internal-call`) and the Next.js route
 * does all the real work.
 *
 * Cadence: 5 minutes. Tighter than the 15-minute inbound-poll because
 * social posts have user-visible scheduled times — a 5-minute jitter is
 * acceptable; longer would feel laggy.
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
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[scheduled:social-publish-due] failed ${res.status}: ${body.slice(0, 500)}`);
    } else {
      console.log(`[scheduled:social-publish-due] ok: ${body.slice(0, 500)}`);
    }
    return new Response(body, { status: res.status });
  } catch (err) {
    console.error('[scheduled:social-publish-due] threw:', err);
    return new Response(String(err), { status: 500 });
  }
};

export const config: Config = {
  schedule: '*/5 * * * *',
};
