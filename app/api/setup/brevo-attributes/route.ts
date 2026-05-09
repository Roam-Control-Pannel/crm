import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * One-time-ish setup endpoint that ensures all the contact attributes the
 * CRM writes to actually exist in Brevo.
 *
 * Brevo silently ignores writes to attributes that haven't been registered
 * in your account. So if we PUT { OUTREACH_STATUS: 'email_sent' } against
 * a contact and OUTREACH_STATUS hasn't been created as a normal attribute,
 * the value just disappears. This route fixes that by creating any missing
 * attributes via the Brevo dashboard's API equivalent.
 *
 * Idempotent: safe to run repeatedly — only attributes that don't already
 * exist will be created.
 *
 * Auth: gated by CRON_SECRET_V2 the same way /api/sequences is. Hit with
 *   POST /api/setup/brevo-attributes (Authorization: Bearer ${CRON_SECRET_V2})
 *
 * For convenience, also accessible via:
 *   GET /api/setup/brevo-attributes?secret=...
 *
 * Returns a JSON report of what was created vs what already existed.
 */

const BREVO_BASE = 'https://api.brevo.com/v3';

type AttrType = 'text' | 'date' | 'float' | 'boolean';

interface RequiredAttribute {
  name: string;
  type: AttrType;
  description: string;
}

/**
 * Every attribute the CRM writes to. Order roughly: identity → outreach
 * status → engagement (webhook-fed) → metadata.
 */
const REQUIRED: RequiredAttribute[] = [
  // Outreach state — set by /api/brevo/send and /api/sequences cron.
  { name: 'OUTREACH_STATUS',     type: 'text',  description: 'not_contacted | email_sent | followed_up | final_nudge | responded | listed | cold' },
  { name: 'LAST_CONTACT_DATE',   type: 'date',  description: 'Date of most recent send to this contact' },

  // Personalisation context — set on import / first send.
  { name: 'TOWN',                type: 'text',  description: 'Local town for personalisation' },
  { name: 'KNOWN_FOR',           type: 'text',  description: 'What the town is known for' },
  { name: 'WEBSITE',             type: 'text',  description: 'Business website (from enrichment)' },
  { name: 'PHONE',               type: 'text',  description: 'Business phone (from enrichment)' },
  { name: 'SOURCE',              type: 'text',  description: 'google | yell | manual | csv' },
  { name: 'NOTES',               type: 'text',  description: 'Manual notes from CRM' },
  { name: 'REGION',              type: 'text',  description: 'County or region' },

  // Engagement signals — set by /api/brevo/webhook on Brevo events.
  { name: 'LAST_DELIVERED_AT',   type: 'date',  description: 'Most recent delivery timestamp' },
  { name: 'LAST_OPENED_AT',      type: 'date',  description: 'Most recent open timestamp' },
  { name: 'OPEN_COUNT',          type: 'float', description: 'Total opens across all sends' },
  { name: 'LAST_CLICKED_AT',     type: 'date',  description: 'Most recent link click timestamp' },
  { name: 'CLICK_COUNT',         type: 'float', description: 'Total clicks across all sends' },
  { name: 'BOUNCED_AT',          type: 'date',  description: 'Most recent bounce timestamp' },
  { name: 'BOUNCE_TYPE',         type: 'text',  description: 'hard | soft' },
  { name: 'UNSUBSCRIBED_AT',     type: 'date',  description: 'Unsubscribe event timestamp' },
  { name: 'SPAM_AT',             type: 'date',  description: 'Spam complaint timestamp' },
  { name: 'BLOCKED_AT',          type: 'date',  description: 'Blocked event timestamp' },
];

/**
 * BUSINESS_NAME already exists in your Brevo account (we saw it in the
 * attributes list). It's referenced here for documentation but excluded
 * from the create loop to avoid 4xx on duplicate.
 */
const ALREADY_EXISTS = ['BUSINESS_NAME'];

interface BrevoAttribute {
  name: string;
  category: string;
  type?: string;
}

async function listExistingAttributes(): Promise<Set<string>> {
  const res = await fetch(`${BREVO_BASE}/contacts/attributes`, {
    headers: { 'api-key': process.env.BREVO_API_KEY || '', accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo list-attributes failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  // Brevo returns: { attributes: [{ name, category, type, ... }, ...] }
  const all: BrevoAttribute[] = data.attributes || [];
  // We only care about 'normal' category — the others are transactional,
  // calculated, etc. and aren't relevant for our PUT-via-contacts pattern.
  const set = new Set<string>();
  for (const a of all) {
    if (a.category === 'normal') {
      set.add(a.name.toUpperCase());
    }
  }
  return set;
}

async function createAttribute(attr: RequiredAttribute): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${BREVO_BASE}/contacts/attributes/normal/${encodeURIComponent(attr.name)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: attr.type }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body: body.slice(0, 300) };
}

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  // Convenience: query string (only safe because this endpoint creates
  // attributes idempotently — no destructive action).
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') === secret) return true;
  return false;
}

async function runSetup() {
  if (!process.env.BREVO_API_KEY) {
    return NextResponse.json({ error: 'BREVO_API_KEY not configured' }, { status: 500 });
  }

  try {
    const existing = await listExistingAttributes();

    const report = {
      alreadyExisted: [] as string[],
      created: [] as string[],
      failed: [] as Array<{ name: string; status: number; body: string }>,
    };

    for (const attr of REQUIRED) {
      const upperName = attr.name.toUpperCase();
      if (existing.has(upperName) || ALREADY_EXISTS.includes(upperName)) {
        report.alreadyExisted.push(attr.name);
        continue;
      }
      const result = await createAttribute(attr);
      if (result.ok) {
        report.created.push(attr.name);
      } else {
        // Brevo returns 400 if it already exists (rare race). Treat as success.
        if (result.status === 400 && /already.*exist/i.test(result.body)) {
          report.alreadyExisted.push(attr.name);
        } else {
          report.failed.push({ name: attr.name, status: result.status, body: result.body });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      summary: `Created ${report.created.length}, already existed ${report.alreadyExisted.length}, failed ${report.failed.length}`,
      ...report,
    });
  } catch (err: any) {
    console.error('[setup-attributes] crashed:', err);
    return NextResponse.json({ error: err?.message || 'Setup failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runSetup();
}

// GET form for browser convenience: visit
//   /api/setup/brevo-attributes?secret=YOUR_CRON_SECRET_V2
// to run the setup interactively.
export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runSetup();
}
