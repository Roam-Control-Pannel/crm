import { NextRequest, NextResponse } from 'next/server';
import { createContact, getContacts, updateContact } from '@/lib/brevo';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get('limit') || 50);
    const offset = Number(searchParams.get('offset') || 0);
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
    const { name, email, town, region, type, source, status, website, phone, notes } = body;

    if (!email || !name || !town) {
      return NextResponse.json(
        { error: 'email, name and town are required' },
        { status: 400 }
      );
    }

    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';

    const contact = await createContact({
      email,
      firstName,
      lastName,
      attributes: {
        BUSINESS_NAME: name,
        TOWN: town,
        REGION: region || '',
        BUSINESS_TYPE: type || '',
        SOURCE: source || 'manual',
        OUTREACH_STATUS: status || 'not_contacted',
        WEBSITE: website || '',
        PHONE: phone || '',
        NOTES: notes || '',
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
    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }
    await updateContact(email, attributes);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update contact';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
