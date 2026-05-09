import type { Config } from '@netlify/functions';

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
    });
    const body = await res.text();
    console.log(`[inbound-poll] ${res.status} ${body.slice(0, 500)}`);
    return new Response(body, { status: res.status });
  } catch (err: any) {
    console.error('[inbound-poll] fetch failed:', err?.message);
    return new Response(err?.message || 'Failed', { status: 500 });
  }
};

export const config: Config = {
  schedule: '*/15 * * * *', // every 15 minutes
};
