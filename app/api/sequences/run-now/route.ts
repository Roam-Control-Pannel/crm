import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Server-side proxy for "Run sequences now" button on /sequences.
 *
 * The /api/sequences endpoint requires the CRON_SECRET_V2. We don't want to
 * ship that secret to the browser, so the UI POSTs here, and this server
 * route adds the secret server-side and forwards the call.
 *
 * Future: when we have a real auth system, gate this on session/admin role.
 */

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET_V2 not configured' }, { status: 500 });
  }

  // Optional listId from the UI. When present, sequences only processes
  // contacts in that Brevo list. Body-parsing failures are non-fatal —
  // an empty body just means "all contacts".
  let listId: number | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.listId === 'number') {
      listId = body.listId;
    }
  } catch {
    // No body, that's fine.
  }

  const origin = new URL(req.url).origin;
  const target = listId
    ? `${origin}/api/sequences?listId=${encodeURIComponent(listId)}`
    : `${origin}/api/sequences`;

  try {
    const res = await fetch(target, {
      method: 'GET',
      headers: { 'x-internal-call': secret },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    console.error('run-now proxy failed:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to trigger sequences' },
      { status: 500 }
    );
  }
}
