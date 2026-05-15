import type { Config } from '@netlify/functions';

/**
 * CRON-PUBLISH-V1
 *
 * Scheduled function: every minute, hit /api/social/publish-due so any
 * social post whose scheduledAt has arrived gets published with no more
 * than ~60s of jitter.
 *
 * Pattern mirrors inbound-poll.mts and sequences-daily.mts — the secret
 * lives only on the server, never in this function or the browser. The
 * function itself is deliberately thin: it forwards the call with a
 * Bearer-equivalent header (`x-internal-call`) and the Next.js route
 * does all the real work.
 *
 * Cadence: 1 minute. This is Netlify's minimum cron granularity, so it's
 * the tightest "fire on scheduledAt" we can achieve with the existing
 * infra. Sub-minute precision would require either platform-native
 * scheduling (mixed support across LinkedIn/FB/IG) or a separate job
 * queue. Worst-case delay for a post scheduled at HH:MM:00 is the cron
 * landing at HH:MM:59 → ~60s.
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
  schedule: '* * * * *',
};
