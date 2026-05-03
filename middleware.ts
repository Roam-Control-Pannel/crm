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
        if (pathname.startsWith('/api/')) return true;
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: ['/((?!login|_next/static|_next/image|favicon.ico).*)'],
};
