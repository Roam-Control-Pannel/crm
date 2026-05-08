import type { Config } from '@netlify/functions';

/**
 * Daily outreach sequences cron.
 *
 * Fires at 08:00 UTC every day, which is:
 *   - 09:00 UK time during BST (late March → late October)
 *   - 08:00 UK time during GMT (late October → late March)
 *
 * UTC was chosen over a TZ-aware schedule because Netlify scheduled
 * functions run on a single UTC cron expression. Accepting the seasonal
 * shift keeps the schedule predictable and the config simple.
 *
 * The function makes a server-to-server HTTP call to /api/sequences with
 * the Bearer secret. The Next.js route handles all the actual logic
 * (Brevo reads, sends, status updates, run record).
 */

export default async () => {
  const url = process.env.URL || 'https://roam-crm-platform.netlify.app';
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error('[scheduled:sequences] CRON_SECRET not set; aborting.');
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), { status: 500 });
  }

  try {
    const res = await fetch(`${url}/api/sequences`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[scheduled:sequences] failed ${res.status}: ${body.slice(0, 500)}`);
    } else {
      console.log(`[scheduled:sequences] ok: ${body.slice(0, 500)}`);
    }
    return new Response(body, { status: res.status });
  } catch (err) {
    console.error('[scheduled:sequences] threw:', err);
    return new Response(String(err), { status: 500 });
  }
};

export const config: Config = {
  // 8am UTC daily — 9am UK during BST, 8am UK during GMT.
  schedule: '0 8 * * *',
};
