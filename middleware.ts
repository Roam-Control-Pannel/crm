import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

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
        // Cron/sequences gate themselves with a bearer secret server-side.
        if (pathname === '/api/cron' || pathname === '/api/sequences') return true;
        // Everything else (including /api/*) requires a session.
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
