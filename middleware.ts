import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/safe-equal';

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
  '/api/social/publish-due',        // CRON-PUBLISH-V1: secret-gated scheduled-post publisher
  '/api/social/auto-generate',      // CRON-AUTOGEN-V1: bearer-gated cron endpoint
  '/api/social/auto-generate/run-now', // CRON-AUTOGEN-V1: bearer-gated manual trigger (UI proxy)
];

function isPublicApiRoute(pathname: string): boolean {
  // Exact-match the public list. Substring matching would be too broad
  // (e.g. /api/sequences/anything-else would unexpectedly bypass auth).
  return PUBLIC_API_ROUTES.includes(pathname);
}

/**
 * Public read of a stored image by id: /api/images/<id>.
 *
 * These must be fetchable by unauthenticated external parties:
 *   - Meta's Graph API crawler fetches image_url / url when publishing to
 *     Facebook and Instagram (IG can ONLY ingest via a public URL — it has
 *     no binary-upload path), and
 *   - our own server-side fetch for the LinkedIn image upload runs without
 *     a session cookie.
 * Without this, the auth middleware 307-redirects the crawler to /login and
 * Meta receives an HTML page instead of the image, surfacing as
 * "Only photo or video can be accepted as media type" / "image format is
 * not supported" / "Missing or invalid image file". IDs are unguessable
 * (img_<timestamp>_<random>) and the images are destined for public social
 * posts, so public read is appropriate.
 *
 * Scope is deliberately narrow: a single path segment only (no nested
 * paths), and the write/proxy sub-routes stay gated. Combined with the
 * GET-only guard at the call site, this exposes nothing but image bytes.
 */
const IMAGE_WRITE_SUBROUTES = new Set(['upload', 'search', 'track-download']);

function isPublicImageRead(pathname: string): boolean {
  if (!pathname.startsWith('/api/images/')) return false;
  const rest = pathname.slice('/api/images/'.length);
  if (!rest || rest.includes('/')) return false;
  return !IMAGE_WRITE_SUBROUTES.has(rest);
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
        // Public image reads (GET /api/images/<id>) — Meta's FB/IG crawler
        // and our own LinkedIn upload fetch pull these without a session.
        if (req.method === 'GET' && isPublicImageRead(pathname)) return true;
        // CRON-AUTOGEN-V1: server-to-server internal calls.
        // Background jobs and the run-now UI proxy attach
        // x-internal-call with CRON_SECRET_V2 to authenticate
        // server-to-server fetches into the app's own API. This
        // lets the cron reach any route it needs without each one
        // being individually allow-listed. Routes that want defence
        // in depth can still validate the header on entry (the
        // auto-generate route does — see app/api/social/auto-generate
        // /route.ts).
        const internalSecret = req.headers.get('x-internal-call');
        if (
          internalSecret &&
          process.env.CRON_SECRET_V2 &&
          safeEqual(internalSecret, process.env.CRON_SECRET_V2)
        ) {
          return true;
        }
        // Everything else (including /api/*) requires a session.
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
