import { NextRequest, NextResponse } from 'next/server';
import { saveMetaTokens, DEFAULT_USER_ID, type MetaTokens } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    if (error) {
      return NextResponse.redirect(new URL(`/channels?meta_error=${error}`, req.url));
    }
    if (!code) {
      return NextResponse.redirect(new URL('/channels?meta_error=no_code', req.url));
    }

    const expectedState = req.cookies.get('meta_oauth_state')?.value;
    if (!state || !expectedState || state !== expectedState) {
      return NextResponse.redirect(new URL('/channels?meta_error=state_mismatch', req.url));
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    // Configured value must match exactly what's registered in Meta's app
    // settings. Falls back to the current production URL so existing deploys
    // keep working without an env-var change.
    const redirectUri =
      process.env.META_REDIRECT_URI ||
      'https://roam-crm-platform.netlify.app/api/auth/meta/callback';

    // Step 1: Exchange code for short-lived user token
    const tokenParams = new URLSearchParams({
      client_id: appId || '',
      redirect_uri: redirectUri,
      client_secret: appSecret || '',
      code,
    });
    const tokenRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${tokenParams}`);
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('Meta token exchange failed:', tokenData);
      return NextResponse.redirect(new URL('/channels?meta_error=token_failed', req.url));
    }

    // Step 2: Exchange short-lived for long-lived (60 day) token.
    // The token is passed in URLSearchParams so the access_token doesn't
    // appear in the URL string (which can be captured by access logs,
    // browser history, or referer headers on errors).
    const longParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId || '',
      client_secret: appSecret || '',
      fb_exchange_token: tokenData.access_token,
    });
    const longRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${longParams}`);
    const longData = await longRes.json();
    const userToken = longData.access_token || tokenData.access_token;

    // Step 3: Get list of pages user manages, with page tokens. Pass the
    // user token via Authorization header instead of access_token query
    // param so it doesn't end up in any URL-aware log.
    const pagesUrl = new URL('https://graph.facebook.com/v21.0/me/accounts');
    pagesUrl.searchParams.set('fields', 'id,name,access_token,instagram_business_account');
    const pagesRes = await fetch(pagesUrl, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const pagesData = await pagesRes.json();

    const pages = (pagesData.data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      pageToken: p.access_token,
      instagramId: p.instagram_business_account?.id,
    }));

    const meta: MetaTokens = {
      userToken,
      expiresAt: Date.now() + (60 * 24 * 60 * 60 * 1000), // 60 days
      pages,
      connectedAt: Date.now(),
    };

    await saveMetaTokens(DEFAULT_USER_ID, meta);

    const res = NextResponse.redirect(new URL('/channels?meta_connected=1', req.url));
    res.cookies.delete('meta_oauth_state');
    return res;
  } catch (err) {
    console.error('Meta OAuth error:', err);
    return NextResponse.redirect(new URL('/channels?meta_error=server_error', req.url));
  }
}
