import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

const REDIRECT_URI = 'https://roam-crm-platform.netlify.app/api/auth/meta/callback';
// Scopes required for connecting Facebook Pages + Instagram Business accounts
// and publishing on the user's behalf. `email` and `public_profile` are NOT
// required for this flow and `email` is rejected by the OAuth dialog without
// App Review approval.
const SCOPE = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_metadata',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
].join(',');

export async function GET(req: NextRequest) {
  const appId = process.env.META_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: 'META_APP_ID not set' }, { status: 500 });
  }

  const state = randomBytes(24).toString('hex');
  const authorizeUrl =
    `https://www.facebook.com/v21.0/dialog/oauth` +
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
