import { NextRequest, NextResponse } from 'next/server';
import { createContact, getContacts, updateContact } from '@/lib/brevo';
import { requireSession } from '@/lib/auth';

const BREVO_API_KEY = process.env.BREVO_API_KEY!;

const ALLOWED_PUT_ATTRIBUTES = [
  'OUTREACH_STATUS', 'NOTES', 'BUSINESS_NAME', 'BUSINESS_TYPE',
  'TOWN', 'REGION', 'WEBSITE', 'PHONE', 'KNOWN_FOR',
] as const;

export async function GET(req: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get('limit') || 500);
    const offset = Number(searchParams.get('offset') || 0);
    const listId = searchParams.get('listId');

    if (listId) {
      const res = await fetch(
        `https://api.brevo.com/v3/contacts/lists/${listId}/contacts?limit=${limit}&offset=${offset}`,
        { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } }
      );
      const data = await res.json();
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
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await req.json();
    const { name, email, town, region, type, source, status, website, phone, notes, listIds } = body;

    if (!email || !name || !town) {
      return NextResponse.json({ error: 'email, name and town are required' }, { status: 400 });
    }

    const contact = await createContact({
      email,
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
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await req.json();
    const { email, ...rest } = body;
    if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

    const attributes: Record<string, string> = {};
    for (const key of ALLOWED_PUT_ATTRIBUTES) {
      if (key in rest) attributes[key] = String(rest[key] ?? '');
    }
    if (Object.keys(attributes).length === 0) {
      return NextResponse.json({ error: 'no permitted attributes provided' }, { status: 400 });
    }

    await updateContact(email, attributes);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update contact';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
