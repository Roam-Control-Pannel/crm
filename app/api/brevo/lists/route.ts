import { NextResponse } from 'next/server';

const BREVO_API_KEY = process.env.BREVO_API_KEY!;

export async function GET() {
  try {
    const res = await fetch('https://api.brevo.com/v3/contacts/lists?limit=50&sort=desc', {
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch lists';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, folderId } = await req.json();
    const res = await fetch('https://api.brevo.com/v3/contacts/lists', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, folderId: folderId || 1 }),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
