import { NextRequest, NextResponse } from 'next/server';
import { createContact, getContacts, updateContact } from '@/lib/brevo';

const BREVO_API_KEY = process.env.BREVO_API_KEY!;

function parseIntParam(raw: string | null, fallback: number, min: number, max: number): number | null {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    // Brevo's /contacts endpoints cap at limit=1000; reject anything outside
    // sensible bounds before paying the round-trip.
    const limit = parseIntParam(searchParams.get('limit'), 500, 1, 1000);
    const offset = parseIntParam(searchParams.get('offset'), 0, 0, 1_000_000);
    if (limit === null || offset === null) {
      return NextResponse.json({ error: 'invalid limit or offset' }, { status: 400 });
    }
    const listIdRaw = searchParams.get('listId');
    let listId: number | null = null;
    if (listIdRaw !== null) {
      const n = Number(listIdRaw);
      if (!Number.isInteger(n) || n < 1) {
        return NextResponse.json({ error: 'invalid listId' }, { status: 400 });
      }
      listId = n;
    }

    if (listId !== null) {
      const res = await fetch(
        `https://api.brevo.com/v3/contacts/lists/${listId}/contacts?limit=${limit}&offset=${offset}`,
        { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } }
      );
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ error: data?.message || 'Brevo error', contacts: [] }, { status: res.status });
      }
      return NextResponse.json({ contacts: data.contacts || [] });
    }

    const data = await getContacts(limit, offset);
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch contacts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, town, region, type, source, status, website, phone, notes, listIds } = body;

    if (!email || !name || !town) {
      return NextResponse.json({ error: 'email, name and town are required' }, { status: 400 });
    }

    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';

    const contact = await createContact({
      email, firstName, lastName,
      listIds: listIds || [],
      attributes: {
        BUSINESS_NAME: name, TOWN: town, REGION: region || '',
        BUSINESS_TYPE: type || '', SOURCE: source || 'manual',
        OUTREACH_STATUS: status || 'not_contacted',
        WEBSITE: website || '', PHONE: phone || '', NOTES: notes || '',
      },
    });

    return NextResponse.json({ success: true, contact });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create contact';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, ...attributes } = body;
    if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });
    await updateContact(email, attributes);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update contact';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
