import { NextRequest, NextResponse } from 'next/server';
import {
  recordCronRun,
  sendsToday,
  type CronRunRecord,
} from '@/lib/cron-status';
import { fetchAllContacts } from '@/lib/brevo';
import { getAppSettings } from '@/lib/app-settings';
import { safeEqual } from '@/lib/safe-equal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Daily outreach follow-up runner.
 *
 * Reads contacts from Brevo, sends Day 2 / Day 7 follow-ups based on each
 * contact's OUTREACH_STATUS and LAST_CONTACT_DATE, marks Day 14 as cold.
 * Enforces a daily send cap, records run history, and writes the status
 * blob the /sequences UI reads.
 *
 * Auth modes:
 *   - Bearer ${CRON_SECRET_V2} on Authorization header (used by the scheduled
 *     Netlify Function and any external cron caller)
 *   - Internal call from /api/sequences/run-now via x-internal-call header
 *     (the server proxies user clicks through there so the secret never
 *     ships to the browser)
 */

interface BrevoContact {
  id: number;
  email: string;
  attributes?: Record<string, string>;
}

const BREVO_BASE = 'https://api.brevo.com/v3';

interface SenderOpts {
  name: string;
  email: string;
  replyTo: string;
}

function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

function authorize(req: NextRequest): { ok: boolean; reason?: string } {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    return { ok: false, reason: 'CRON_SECRET_V2 not configured' };
  }
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ') && safeEqual(auth.slice(7), secret)) {
    return { ok: true };
  }
  // Allow same-origin internal proxy call (run-now button)
  const internal = req.headers.get('x-internal-call');
  if (internal && safeEqual(internal, secret)) return { ok: true };
  return { ok: false, reason: 'Unauthorized' };
}

async function sendFollowUp(
  contact: BrevoContact,
  step: 2 | 3,
  sender: SenderOpts
): Promise<boolean> {
  const name = contact.attributes?.BUSINESS_NAME || contact.attributes?.FIRSTNAME || contact.email;
  const town = contact.attributes?.TOWN || 'your area';

  const subjects: Record<number, string> = {
    2: `Just checking in — ${town} on Roam`,
    3: `Last one from us — ${name}`,
  };

  const bodies: Record<number, string> = {
    2: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a0d12">
  <p>Hi there,</p>
  <p>Just a quick follow-up — we'd love to have <strong>${name}</strong> on Roam's <strong>${town}</strong> page.</p>
  <p>It's completely free and takes 90 seconds. Businesses across ${town} are already signing up.</p>
  <p style="margin-top:20px"><a href="https://roam-local.co.uk" style="background:#8B1A3A;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:700">Get listed now →</a></p>
  <p>Best wishes,<br/>— Roam Local Team</p>
</div>`,
    3: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a0d12">
  <p>Hi there,</p>
  <p>We won't chase again after this — promise!</p>
  <p>If you'd like <strong>${name}</strong> featured on Roam's <strong>${town}</strong> page for free, it only takes 90 seconds.</p>
  <p style="margin-top:20px"><a href="https://roam-local.co.uk" style="background:#8B1A3A;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:700">List for free →</a></p>
  <p>Best wishes,<br/>— Roam Local Team</p>
</div>`,
  };

  try {
    const res = await fetch(`${BREVO_BASE}/smtp/email`, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: sender.name, email: sender.email },
        to: [{ email: contact.email, name }],
        subject: subjects[step],
        htmlContent: bodies[step],
        replyTo: { email: sender.replyTo, name: sender.name },
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('sendFollowUp failed:', err);
    return false;
  }
}

async function updateStatus(email: string, attrs: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch(`${BREVO_BASE}/contacts/${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: {
        'api-key': process.env.BREVO_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ attributes: attrs }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[sequences] updateStatus ${res.status} for ${redactEmail(email)}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[sequences] updateStatus threw for ${redactEmail(email)}:`, err?.message);
    return false;
  }
}

export async function GET(req: NextRequest) {
  const auth = authorize(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 });
  }

  // Optional list filter — used by the manual "Run sequences now" button when
  // a list is selected on the /sequences page. The scheduled cron always
  // runs without a listId so it processes all contacts.
  const { searchParams } = new URL(req.url);
  const listId = searchParams.get('listId');

  const now = new Date();
  const todayDate = now.toISOString().slice(0, 10);
  const counts = { day2: 0, day7: 0, day14: 0, errors: 0, processed: 0 };
  let capped = false;

  try {
    // Cadence + cap come from the Settings page (Netlify Blobs). Defaults
    // mirror the previously hardcoded values so an empty blob preserves
    // existing behaviour.
    const settings = await getAppSettings();
    const senderOpts: SenderOpts = {
      name: settings.sender.name,
      email: settings.sender.email,
      replyTo: settings.sender.replyTo,
    };
    const followUpDays = settings.cadence.followUpDays;
    const finalNudgeDays = settings.cadence.finalNudgeDays;
    const coldDays = settings.cadence.coldDays;
    const dailyCap = settings.cadence.dailySendCap;

    // Pull every contact across all pages — sequences must reach the full
    // 11k+ list, not just the most recent 500 (see lib/brevo.ts > fetchAllContacts).
    const { contacts } = await fetchAllContacts({ listId });
    counts.processed = contacts.length;

    let alreadySent = await sendsToday();

    for (const contact of contacts) {
      if (!contact.email) continue;
      // Honour per-contact pause: contacts the user has manually paused
      // (e.g. after a reply, or because they don't want auto follow-ups)
      // keep their current OUTREACH_STATUS but the cron leaves them alone.
      if (contact.attributes?.PAUSED === 'true') continue;
      const status = contact.attributes?.OUTREACH_STATUS;
      const lastContact = contact.attributes?.LAST_CONTACT_DATE;
      if (!lastContact) continue;

      const daysSince = Math.floor(
        (now.getTime() - new Date(lastContact).getTime()) / 86_400_000
      );

      // Day 2 — follow-up
      if (status === 'email_sent' && daysSince >= followUpDays) {
        if (alreadySent >= dailyCap) {
          capped = true;
          continue;
        }
        const sent = await sendFollowUp(contact, 2, senderOpts);
        if (sent) {
          // Send already happened; if the status update fails we MUST count
          // this as an error — otherwise the next cron run sees the contact
          // still in `email_sent` and re-sends day 2.
          const statusOk = await updateStatus(contact.email, {
            OUTREACH_STATUS: 'followed_up',
            LAST_CONTACT_DATE: todayDate,
          });
          counts.day2++;
          alreadySent++;
          if (!statusOk) counts.errors++;
        } else {
          counts.errors++;
        }
      }
      // Day 7 — final nudge
      else if (status === 'followed_up' && daysSince >= finalNudgeDays) {
        if (alreadySent >= dailyCap) {
          capped = true;
          continue;
        }
        const sent = await sendFollowUp(contact, 3, senderOpts);
        if (sent) {
          const statusOk = await updateStatus(contact.email, {
            OUTREACH_STATUS: 'final_nudge',
            LAST_CONTACT_DATE: todayDate,
          });
          counts.day7++;
          alreadySent++;
          if (!statusOk) counts.errors++;
        } else {
          counts.errors++;
        }
      }
      // Day 14 — mark cold
      else if (status === 'final_nudge' && daysSince >= coldDays) {
        const statusOk = await updateStatus(contact.email, { OUTREACH_STATUS: 'cold' });
        if (statusOk) counts.day14++;
        else counts.errors++;
      }
    }

    const message = `Processed ${counts.processed} contacts · Day ${followUpDays}: ${counts.day2} · Day ${finalNudgeDays}: ${counts.day7} · Day ${coldDays}: ${counts.day14} cold${capped ? ' · CAPPED at ' + dailyCap : ''}${counts.errors ? ' · ' + counts.errors + ' errors' : ''}`;

    const record: CronRunRecord = {
      ranAt: now.toISOString(),
      ok: counts.errors === 0,
      day2Sent: counts.day2,
      day7Sent: counts.day7,
      day14Cold: counts.day14,
      errors: counts.errors,
      capped,
      message,
    };
    await recordCronRun(record);

    return NextResponse.json({ success: true, ...counts, capped, message, record });
  } catch (err: any) {
    console.error('Sequences error:', err);
    const record: CronRunRecord = {
      ranAt: now.toISOString(),
      ok: false,
      day2Sent: counts.day2,
      day7Sent: counts.day7,
      day14Cold: counts.day14,
      errors: counts.errors + 1,
      capped,
      message: err?.message || 'Unknown error',
    };
    await recordCronRun(record);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed', record },
      { status: 500 }
    );
  }
}
