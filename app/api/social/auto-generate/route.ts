import { NextRequest, NextResponse } from 'next/server';
import { runAutoGenerate } from '@/lib/social-cron';
import { safeEqual } from '@/lib/safe-equal';

// CRON-AUTOGEN-V1
// Auto-generate social posts cron endpoint.
//
// Auth: requires x-internal-call header with CRON_SECRET_V2. The Netlify
// scheduled function and the /run-now UI proxy both inject this server-side.
// Calls from the browser without the header are rejected with 401.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return handle(req);
}

// Netlify Scheduled Functions send POST; supporting both means scheduler and
// manual curl tests work without surprise.
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET_V2 not configured' },
      { status: 500 }
    );
  }

  const provided = req.headers.get('x-internal-call');
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Optional one-shot lookahead override from the UI's Fill calendar button
  let lookaheadDaysOverride: number | undefined;
  try {
    if (req.method === 'POST') {
      const body = await req.json();
      if (body && typeof body.lookaheadDays === 'number') {
        lookaheadDaysOverride = body.lookaheadDays;
      }
    } else {
      const param = new URL(req.url).searchParams.get('lookaheadDays');
      if (param) {
        const n = parseInt(param, 10);
        if (!isNaN(n) && n > 0) lookaheadDaysOverride = n;
      }
    }
  } catch {
    // body parse failures non-fatal
  }

  const origin = new URL(req.url).origin;
  const result = await runAutoGenerate({
    origin,
    internalSecret: secret,
    lookaheadDaysOverride,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
