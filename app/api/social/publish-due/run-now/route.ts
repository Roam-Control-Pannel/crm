import { NextRequest, NextResponse } from 'next/server';

// DEBUG-PUBLISH-RUN-NOW-V1
//
// Browser-triggered manual invocation of /api/social/publish-due. Exists
// solely so we can see the cron route's full JSON response while diagnosing
// why scheduled posts aren't publishing — the Netlify function-log panel
// has been silent on all our scheduled functions, making diagnosis
// impossible from that angle.
//
// Mirrors /api/social/auto-generate/run-now exactly: session-gated (the
// middleware allow-list doesn't include this path, so NextAuth's
// `authorized` callback enforces a session), keeps CRON_SECRET_V2 server-
// side, forwards to the real cron endpoint with the internal-call header,
// and surfaces the response verbatim so we can read it in the browser.
//
// Remove this file once the cron's confirmed working end-to-end.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET_V2 not configured on this deploy' },
      { status: 500 }
    );
  }

  const origin = new URL(req.url).origin;
  try {
    const res = await fetch(`${origin}/api/social/publish-due`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-call': secret,
      },
    });
    // Read as text first so HTML responses (e.g. a NextAuth 307 redirect
    // to /login that we forgot to allow-list) surface a real error
    // instead of 'Unexpected token < in JSON at position 0'.
    const raw = await res.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error('[publish-due/run-now] upstream returned non-JSON (status ' + res.status + '):', raw.slice(0, 500));
      return NextResponse.json(
        {
          ok: false,
          error: 'Upstream returned non-JSON (status ' + res.status + ').',
          // Surface the raw response head so we can see if it's a redirect
          // to /login or an unhandled exception page. Truncated to keep
          // alert() readable.
          rawHead: raw.slice(0, 500),
          upstreamStatus: res.status,
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      {
        ok: data.ok ?? false,
        upstreamStatus: res.status,
        upstreamResponse: data,
      },
      { status: res.status }
    );
  } catch (err: any) {
    console.error('[publish-due/run-now] proxy failed:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to trigger publish-due' },
      { status: 500 }
    );
  }
}
