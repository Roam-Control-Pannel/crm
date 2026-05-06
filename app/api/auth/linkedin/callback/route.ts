import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(new URL('/channels?li_error=access_denied', req.url));
  }

  try {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    const redirectUri = 'https://roam-crm-platform.netlify.app/api/auth/linkedin/callback';

    // Exchange code for access token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId || '',
        client_secret: clientSecret || '',
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return NextResponse.redirect(new URL('/channels?li_error=token_failed', req.url));
    }

    // Get user profile
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();

    const account = {
      name: profile.name || 'LinkedIn Account',
      email: profile.email || '',
      picture: profile.picture || '',
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
    };

    return NextResponse.redirect(
      new URL('/channels?li_connected=true&li_account=' + encodeURIComponent(JSON.stringify(account)), req.url)
    );
  } catch (err) {
    console.error('LinkedIn OAuth error:', err);
    return NextResponse.redirect(new URL('/channels?li_error=server_error', req.url));
  }
}
