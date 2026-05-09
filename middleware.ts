import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

/**
 * Public API routes — these gate themselves server-side via a bearer
 * secret, signed payload, or limited surface area. They must remain
 * accessible without a NextAuth session because they're called by:
 *   - External webhook providers (Brevo) that don't authenticate
 *   - Scheduled cron jobs without user context
 *   - Setup/admin scripts hitting the URL directly
 *
 * Without this exemption, the auth middleware 307-redirects POSTs to
 * /api/auth/signin, which Brevo then follows or treats as a successful
 * delivery — but the actual handler never runs. That is exactly what
 * happened on 9 May 2026 with the engagement webhook silently dropping
 * every event for weeks.
 */
const PUBLIC_API_ROUTES = [
  '/api/cron',                      // legacy cron (kept for back-compat)
  '/api/sequences',                 // bearer-gated outreach cron
  '/api/sequences/run-now',         // bearer-gated manual trigger
  '/api/sequences/status',          // bearer-gated health check
  '/api/brevo/webhook',             // Brevo posts engagement events here
  '/api/setup/brevo-attributes',    // bearer-gated, idempotent setup
  '/api/debug/contact',             // bearer-gated diagnostic
  '/api/inbound/poll',              // bearer-gated IMAP reply poller (cron + manual)
];

function isPublicApiRoute(pathname: string): boolean {
  // Exact-match the public list. Substring matching would be too broad
  // (e.g. /api/sequences/anything-else would unexpectedly bypass auth).
  return PUBLIC_API_ROUTES.includes(pathname);
}

export default withAuth(
  function middleware(req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;
        // NextAuth's own endpoints must remain public so sign-in works.
        if (pathname.startsWith('/api/auth/')) return true;
        // Public, server-gated API routes (webhooks, cron, setup).
        if (isPublicApiRoute(pathname)) return true;
        // Everything else (including /api/*) requires a session.
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
