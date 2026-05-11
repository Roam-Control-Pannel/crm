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
    // CRON-AUTOGEN-V1 hardened: read as text first so HTML responses (e.g. a NextAuth
    // 307→/login that we forgot to allow-list) surface a real error instead of
    // 'Unexpected token < in JSON at position 0'.
    const raw = await res.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error('[auto-generate/run-now] upstream returned non-JSON (status ' + res.status + '):', raw.slice(0, 500));
      return NextResponse.json(
        { ok: false, error: 'Upstream returned non-JSON (status ' + res.status + '). Check function logs.' },
        { status: 502 }
      );
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    console.error('[auto-generate/run-now] proxy failed:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to trigger auto-generate' },
      { status: 500 }
    );
  }
}
