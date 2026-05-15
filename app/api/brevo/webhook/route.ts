import { NextRequest, NextResponse } from 'next/server';
import { addNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Brevo transactional webhook receiver.
 *
 * Brevo POSTs JSON events here for each email lifecycle event:
 *   delivered, opened, click, soft_bounce, hard_bounce, unsubscribed,
 *   spam, blocked, error, deferred
 *
 * Configure in Brevo dashboard:
 *   Transactional → Settings → Webhook → Add webhook
 *   URL:    https://roam-crm-platform.netlify.app/api/brevo/webhook
 *   Events: Delivered, Opened, Click, Hard bounce, Soft bounce,
 *           Unsubscribed, Spam, Blocked
 *
 * Brevo sends the event payload as a single JSON object per request.
 *
 * What we update on each contact (as Brevo attributes):
 *   - LAST_DELIVERED_AT     ISO timestamp of last successful delivery
 *   - LAST_OPENED_AT        ISO timestamp of most recent open
 *   - OPEN_COUNT            integer running total
 *   - LAST_CLICKED_AT       ISO timestamp of last link click
 *   - CLICK_COUNT           integer running total
 *   - BOUNCED_AT            ISO timestamp; presence = currently bouncing
 *   - BOUNCE_TYPE           'hard' | 'soft'
 *   - UNSUBSCRIBED_AT       ISO timestamp of unsubscribe (also blocks future sends)
 *   - SPAM_AT               ISO timestamp of spam complaint
 *   - OUTREACH_STATUS       updated where appropriate (e.g. unsubscribed → 'cold')
 */

const BREVO_BASE = 'https://api.brevo.com/v3';

// Truncate the local part of an email for logging so we keep enough
// information to correlate events without writing full PII into logs.
function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local.slice(0, 2)}***${domain}`;
}

// Attribute names we deliberately exclude from logs. The set is small —
// most CRM attributes are operational metadata (timestamps, counters,
// status enums) and useful in error context; phone/email/name aren't.
const SENSITIVE_ATTR_KEYS = new Set(['EMAIL', 'FIRSTNAME', 'LASTNAME', 'PHONE', 'SMS']);
function redactAttrs(attrs: Record<string, any>): string {
  const safe: Record<string, any> = {};
  for (const [k, v] of Object.entries(attrs)) {
    safe[k] = SENSITIVE_ATTR_KEYS.has(k.toUpperCase()) ? '***' : v;
  }
  return JSON.stringify(safe);
}

async function getContactAttrs(email: string): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(`${BREVO_BASE}/contacts/${encodeURIComponent(email)}`, {
      headers: { 'api-key': process.env.BREVO_API_KEY || '', accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[webhook] getContactAttrs ${res.status} for ${redactEmail(email)}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return data?.attributes || {};
  } catch (err: any) {
    console.error(`[webhook] getContactAttrs threw for ${redactEmail(email)}:`, err?.message);
    return null;
  }
}

async function updateContact(email: string, attributes: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(`${BREVO_BASE}/contacts/${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: {
        'api-key': process.env.BREVO_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ attributes }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[webhook] updateContact ${res.status} for ${redactEmail(email)} attrs=${redactAttrs(attributes)}: ${body.slice(0, 200)}`);
      return false;
    }
    console.log(`[webhook] updateContact OK for ${redactEmail(email)} attrs=${redactAttrs(attributes)}`);
    return true;
  } catch (err: any) {
    console.error(`[webhook] updateContact threw for ${redactEmail(email)}:`, err?.message);
    return false;
  }
}

function nowIso() { return new Date().toISOString(); }

export async function POST(req: NextRequest) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Log a structural summary only — full payloads include contact email +
  // attributes (PII). The per-event lines below already log redacted email
  // + event type for debugging.
  const summary = Array.isArray(payload)
    ? { kind: 'array', count: payload.length, events: payload.map((e: any) => e?.event).filter(Boolean) }
    : { kind: 'object', event: payload?.event };
  console.log('[webhook] payload received:', JSON.stringify(summary));

  // Brevo posts events with shape:
  //   { event, email, ts, message-id, ... event-specific fields }
  // For batches it can be an array; handle both.
  const events: any[] = Array.isArray(payload) ? payload : [payload];

  const results = { processed: 0, updated: 0, skipped: 0, errors: 0 };

  for (const evt of events) {
    const email = evt?.email;
    const event = evt?.event;
    if (!email || !event) {
      console.warn(`[webhook] skipping event with missing email/event: ${JSON.stringify(evt).slice(0, 200)}`);
      results.skipped++;
      continue;
    }
    console.log(`[webhook] processing event=${event} email=${redactEmail(email)}`);
    results.processed++;

    // Pull current attrs so we can increment counters.
    const current = await getContactAttrs(email);
    if (!current) {
      // Contact not in Brevo (e.g. one-off transactional with no contact record).
      // Skip silently — nothing to update.
      results.skipped++;
      continue;
    }

    const patch: Record<string, any> = {};
    const ts = nowIso();
    // Notification queue for this event. We collect them here and fire after
    // the contact update succeeds so we don't notify about a state we failed
    // to persist.
    let notif: {
      type: 'hot_lead' | 'engagement' | 'bounce' | 'unsubscribe';
      title: string;
      body: string;
      dedupeKey: string;
    } | null = null;
    const displayName = current.BUSINESS_NAME || current.FIRSTNAME || email;

    switch (event) {
      case 'delivered':
        patch.LAST_DELIVERED_AT = ts;
        // Clear any prior bounce flag on a successful delivery.
        if (current.BOUNCED_AT) {
          patch.BOUNCED_AT = '';
          patch.BOUNCE_TYPE = '';
        }
        // No notification — delivered is the expected happy path.
        break;

      case 'opened':
      case 'unique_opened': {
        patch.LAST_OPENED_AT = ts;
        const prevOpens = Number(current.OPEN_COUNT || 0);
        patch.OPEN_COUNT = String(prevOpens + 1);
        // Notify only on FIRST open of an email cycle. Repeat opens are noise.
        // Dedupe key includes the day so a re-engagement after weeks notifies
        // again, but multiple opens in one day stay quiet.
        if (prevOpens === 0) {
          notif = {
            type: 'engagement',
            title: `${displayName} opened your email`,
            body: 'First open — they\u2019re reading.',
            dedupeKey: `engagement:${email}:${ts.slice(0, 10)}`,
          };
        }
        break;
      }

      case 'click':
        patch.LAST_CLICKED_AT = ts;
        patch.CLICK_COUNT = String(Number(current.CLICK_COUNT || 0) + 1);
        // Click = hot lead. Always notify — high-value signal.
        notif = {
          type: 'hot_lead',
          title: `\ud83d\udd25 ${displayName} clicked through`,
          body: 'Hot lead \u2014 follow up while interest is fresh.',
          dedupeKey: `hot_lead:${email}:${ts.slice(0, 10)}`,
        };
        break;

      case 'hard_bounce':
        patch.BOUNCED_AT = ts;
        patch.BOUNCE_TYPE = 'hard';
        // Hard bounces mean the address is dead. Mark cold so the cron
        // doesn't keep trying.
        patch.OUTREACH_STATUS = 'cold';
        notif = {
          type: 'bounce',
          title: `${displayName} hard-bounced`,
          body: 'Address rejected \u2014 marked cold automatically.',
          dedupeKey: `bounce:${email}`,
        };
        break;

      case 'soft_bounce':
        patch.BOUNCED_AT = ts;
        patch.BOUNCE_TYPE = 'soft';
        // Soft = temporary issue (full mailbox, server down). Don't mark
        // cold; let the cron retry after the standard delay. Don't notify
        // on softs either — they're often transient.
        break;

      case 'unsubscribed':
        patch.UNSUBSCRIBED_AT = ts;
        patch.OUTREACH_STATUS = 'cold';
        notif = {
          type: 'unsubscribe',
          title: `${displayName} unsubscribed`,
          body: 'No further emails will be sent.',
          dedupeKey: `unsub:${email}`,
        };
        break;

      case 'spam':
      case 'complaint':
        patch.SPAM_AT = ts;
        patch.OUTREACH_STATUS = 'cold';
        notif = {
          type: 'bounce',
          title: `${displayName} marked as spam`,
          body: 'Recipient flagged the email \u2014 contact marked cold.',
          dedupeKey: `spam:${email}`,
        };
        break;

      case 'blocked':
        patch.BLOCKED_AT = ts;
        patch.OUTREACH_STATUS = 'cold';
        // No notification — blocks are usually our own sender-side issue,
        // less actionable per-contact.
        break;

      // 'error', 'deferred', 'request', etc. — ignore for now
      default:
        results.skipped++;
        continue;
    }

    const ok = await updateContact(email, patch);
    if (ok) {
      results.updated++;
      // Fire the notification only after a successful contact update.
      if (notif) {
        await addNotification({
          ...notif,
          contactEmail: email,
          href: `/contacts?search=${encodeURIComponent(email)}`,
        });
      }
    } else {
      results.errors++;
    }
  }

  console.log(`[webhook] done: processed=${results.processed} updated=${results.updated} skipped=${results.skipped} errors=${results.errors}`);
  return NextResponse.json({ ok: true, ...results });
}

/**
 * Brevo's webhook test feature sends a GET request to verify the URL is
 * reachable. Respond with 200.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    name: 'roam-crm-platform brevo webhook',
    accepts: ['delivered', 'opened', 'click', 'hard_bounce', 'soft_bounce', 'unsubscribed', 'spam', 'blocked'],
  });
}
