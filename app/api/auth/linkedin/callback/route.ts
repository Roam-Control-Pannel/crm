import { NextRequest, NextResponse } from 'next/server';
import { saveLinkedInTokens, DEFAULT_USER_ID, type LinkedInTokens } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    if (error) {
      return NextResponse.redirect(new URL(`/channels?li_error=${error}`, req.url));
    }
    if (!code) {
      return NextResponse.redirect(new URL('/channels?li_error=no_code', req.url));
    }

    const expectedState = req.cookies.get('li_oauth_state')?.value;
    if (!state || !expectedState || state !== expectedState) {
      return NextResponse.redirect(new URL('/channels?li_error=state_mismatch', req.url));
    }

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
      console.error('LinkedIn token exchange failed:', tokenData);
      return NextResponse.redirect(new URL('/channels?li_error=token_failed', req.url));
    }

    // Get user profile (OIDC)
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();

    const grantedScopes = (tokenData.scope || '').split(/[, ]+/).filter(Boolean);
    const canPostPersonal = grantedScopes.includes('w_member_social');
    const canPostCompany = grantedScopes.includes('w_organization_social');
    const canListOrgs = grantedScopes.includes('r_organization_admin');

    // Try to fetch organisations (only works if r_organization_admin granted)
    let organisations: Array<{ id: string; name: string; urn: string }> = [];
    if (canListOrgs) {
      try {
        const orgRes = await fetch(
          'https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~(id,localizedName)))',
          { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        );
        const orgData = await orgRes.json();
        organisations = (orgData.elements || []).map((el: any) => ({
          id: el['organization~']?.id || '',
          name: el['organization~']?.localizedName || '',
          urn: `urn:li:organization:${el['organization~']?.id || ''}`,
        }));
      } catch (e) {
        console.error('Org fetch failed:', e);
      }
    }

    const expiresAt = Date.now() + ((tokenData.expires_in || 3600) * 1000);

    const li: LinkedInTokens = {
      accessToken: tokenData.access_token,
      expiresAt,
      refreshToken: tokenData.refresh_token,
      scopes: grantedScopes,
      memberUrn: profile.sub ? `urn:li:person:${profile.sub}` : '',
      name: profile.name || 'LinkedIn Account',
      email: profile.email || '',
      picture: profile.picture,
      organisations,
      capabilities: {
        signIn: true,
        postPersonal: canPostPersonal,
        postCompany: canPostCompany,
        listOrganisations: canListOrgs,
      },
      connectedAt: Date.now(),
    };

    await saveLinkedInTokens(DEFAULT_USER_ID, li);

    // Redirect with success flag only — no sensitive data in URL
    const res = NextResponse.redirect(new URL('/channels?li_connected=1', req.url));
    res.cookies.delete('li_oauth_state');
    return res;
  } catch (err) {
    console.error('LinkedIn OAuth error:', err);
    return NextResponse.redirect(new URL('/channels?li_error=server_error', req.url));
  }
}
