import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Debug endpoint: fetches a single contact's full Brevo attributes payload.
 *
 * Useful when investigating "why isn't this contact's data showing up?"
 * questions. Returns the raw Brevo response so you can see exactly what's
 * stored vs. what we expected.
 *
 * Usage:
 *   GET /api/debug/contact?email=andy@easy-hire.marketing&secret=YOUR_CRON_SECRET_V2
 *
 * Auth-gated by CRON_SECRET_V2 to prevent random people probing your
 * contact data.
 */

const BREVO_BASE = 'https://api.brevo.com/v3';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  const email = searchParams.get('email');

  if (!process.env.CRON_SECRET_V2 || secret !== process.env.CRON_SECRET_V2) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }
  if (!process.env.BREVO_API_KEY) {
    return NextResponse.json({ error: 'BREVO_API_KEY not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(`${BREVO_BASE}/contacts/${encodeURIComponent(email)}`, {
      headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' },
    });
    const body = await res.text();
    if (!res.ok) {
      return NextResponse.json({
        error: 'Brevo fetch failed',
        status: res.status,
        body: body.slice(0, 500),
      }, { status: 502 });
    }
    const data = JSON.parse(body);
    // Highlight the CRM-relevant attributes for quick eyeballing.
    const attrs = data.attributes || {};
    const crmRelevant = {
      OUTREACH_STATUS: attrs.OUTREACH_STATUS ?? '(missing)',
      LAST_CONTACT_DATE: attrs.LAST_CONTACT_DATE ?? '(missing)',
      LAST_DELIVERED_AT: attrs.LAST_DELIVERED_AT ?? '(missing)',
      LAST_OPENED_AT: attrs.LAST_OPENED_AT ?? '(missing)',
      OPEN_COUNT: attrs.OPEN_COUNT ?? '(missing)',
      LAST_CLICKED_AT: attrs.LAST_CLICKED_AT ?? '(missing)',
      CLICK_COUNT: attrs.CLICK_COUNT ?? '(missing)',
      BUSINESS_NAME: attrs.BUSINESS_NAME ?? '(missing)',
      TOWN: attrs.TOWN ?? '(missing)',
      BOUNCED_AT: attrs.BOUNCED_AT ?? '(missing)',
    };
    return NextResponse.json({
      ok: true,
      email: data.email,
      id: data.id,
      modifiedAt: data.modifiedAt,
      crmRelevant,
      allAttributes: attrs,
      listIds: data.listIds,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}
