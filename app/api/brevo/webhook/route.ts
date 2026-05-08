import { NextRequest, NextResponse } from 'next/server';

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

async function getContactAttrs(email: string): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(`${BREVO_BASE}/contacts/${encodeURIComponent(email)}`, {
      headers: { 'api-key': process.env.BREVO_API_KEY || '', accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.attributes || {};
  } catch {
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
    return res.ok;
  } catch {
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

  // Brevo posts events with shape:
  //   { event, email, ts, message-id, ... event-specific fields }
  // For batches it can be an array; handle both.
  const events: any[] = Array.isArray(payload) ? payload : [payload];

  const results = { processed: 0, updated: 0, skipped: 0, errors: 0 };

  for (const evt of events) {
    const email = evt?.email;
    const event = evt?.event;
    if (!email || !event) {
      results.skipped++;
      continue;
    }
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

    switch (event) {
      case 'delivered':
        patch.LAST_DELIVERED_AT = ts;
        // Clear any prior bounce flag on a successful delivery.
        if (current.BOUNCED_AT) {
          patch.BOUNCED_AT = '';
          patch.BOUNCE_TYPE = '';
        }
        break;

      case 'opened':
      case 'unique_opened':
        patch.LAST_OPENED_AT = ts;
        patch.OPEN_COUNT = String(Number(current.OPEN_COUNT || 0) + 1);
        break;

      case 'click':
        patch.LAST_CLICKED_AT = ts;
        patch.CLICK_COUNT = String(Number(current.CLICK_COUNT || 0) + 1);
        break;

      case 'hard_bounce':
        patch.BOUNCED_AT = ts;
        patch.BOUNCE_TYPE = 'hard';
        // Hard bounces mean the address is dead. Mark cold so the cron
        // doesn't keep trying.
        patch.OUTREACH_STATUS = 'cold';
        break;

      case 'soft_bounce':
        patch.BOUNCED_AT = ts;
        patch.BOUNCE_TYPE = 'soft';
        // Soft = temporary issue (full mailbox, server down). Don't mark
        // cold; let the cron retry after the standard delay.
        break;

      case 'unsubscribed':
        patch.UNSUBSCRIBED_AT = ts;
        patch.OUTREACH_STATUS = 'cold';
        break;

      case 'spam':
      case 'complaint':
        patch.SPAM_AT = ts;
        patch.OUTREACH_STATUS = 'cold';
        break;

      case 'blocked':
        patch.BLOCKED_AT = ts;
        patch.OUTREACH_STATUS = 'cold';
        break;

      // 'error', 'deferred', 'request', etc. — ignore for now
      default:
        results.skipped++;
        continue;
    }

    const ok = await updateContact(email, patch);
    if (ok) results.updated++;
    else results.errors++;
  }

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
