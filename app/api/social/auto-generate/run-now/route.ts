import { NextRequest, NextResponse } from 'next/server';

// CRON-AUTOGEN-V1
// UI proxy for the Fill Calendar button on /social.
// Mirrors the sequences/run-now pattern: keeps CRON_SECRET_V2 server-side
// and forwards to the auto-generate endpoint with the internal-call header.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET_V2 not configured' },
      { status: 500 }
    );
  }

  let lookaheadDays: number | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.lookaheadDays === 'number') {
      lookaheadDays = body.lookaheadDays;
    }
  } catch {
    // No body — that's fine, use settings default
  }

  const origin = new URL(req.url).origin;
  try {
    const res = await fetch(`${origin}/api/social/auto-generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-call': secret,
      },
      body: JSON.stringify(lookaheadDays !== null ? { lookaheadDays } : {}),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    console.error('[auto-generate/run-now] proxy failed:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to trigger auto-generate' },
      { status: 500 }
    );
  }
}
