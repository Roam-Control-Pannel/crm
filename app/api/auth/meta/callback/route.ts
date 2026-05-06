import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(
      new URL('/channels?meta_error=access_denied', req.url)
    );
  }

  try {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = 'https://roam-crm-platform.netlify.app/api/auth/meta/callback';

    // Exchange code for access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
    );
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return NextResponse.redirect(new URL('/channels?meta_error=token_failed', req.url));
    }

    // Exchange for long-lived token
    const longTokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
    );
    const longToken = await longTokenRes.json();
    const userToken = longToken.access_token || tokenData.access_token;

    // Get user's pages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}&fields=id,name,access_token,instagram_business_account`
    );
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];

    // Build connected accounts data
    const connected = pages.map((page: {id:string;name:string;access_token:string;instagram_business_account?:{id:string}}) => ({
      pageId: page.id,
      pageName: page.name,
      pageToken: page.access_token,
      instagramId: page.instagram_business_account?.id || null,
    }));

    // Store in a cookie temporarily to pass to the channels page
    const response = NextResponse.redirect(
      new URL('/channels?meta_connected=true&pages=' + encodeURIComponent(JSON.stringify(connected)), req.url)
    );

    return response;
  } catch (err) {
    console.error('Meta OAuth error:', err);
    return NextResponse.redirect(new URL('/channels?meta_error=server_error', req.url));
  }
}
