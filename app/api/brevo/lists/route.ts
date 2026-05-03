import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';

const BREVO_API_KEY = process.env.BREVO_API_KEY!;

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
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
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
  try {
    const { name, folderId } = await req.json();
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const res = await fetch('https://api.brevo.com/v3/contacts/lists', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: name.trim(), folderId: folderId || 1 }),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
