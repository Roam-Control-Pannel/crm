import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

const REDIRECT_URI = 'https://roam-crm-platform.netlify.app/api/auth/meta/callback';
const SCOPE = 'pages_show_list,pages_read_engagement,pages_manage_posts,public_profile,email';

export async function GET(req: NextRequest) {
  const appId = process.env.META_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: 'META_APP_ID not set' }, { status: 500 });
  }

  const state = randomBytes(24).toString('hex');
  const authorizeUrl =
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&response_type=code` +
    `&state=${state}`;

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set('meta_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
