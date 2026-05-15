import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

// Must match callback route's redirectUri exactly (and what's registered
// in the LinkedIn app). Keep both in sync via the same env var.
const REDIRECT_URI =
  process.env.LINKEDIN_REDIRECT_URI ||
  'https://roam-crm-platform.netlify.app/api/auth/linkedin/callback';
const SCOPE = 'openid profile email w_member_social';

export async function GET(req: NextRequest) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'LINKEDIN_CLIENT_ID not set' }, { status: 500 });
  }

  const state = randomBytes(24).toString('hex');
  const authorizeUrl =
    `https://www.linkedin.com/oauth/v2/authorization` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&state=${state}`;

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set('li_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
