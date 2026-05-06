import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(new URL(`/channels?li_error=${error}`, req.url));
    }

    if (!code) {
      return NextResponse.redirect(new URL('/channels?li_error=no_code', req.url));
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

    // Get user profile (OIDC userinfo endpoint)
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();

    // Detect granted scopes from token response
    const grantedScopes = (tokenData.scope || '').split(/[, ]+/).filter(Boolean);
    const canPostPersonal = grantedScopes.includes('w_member_social');
    const canPostCompany = grantedScopes.includes('w_organization_social');
    const canListOrgs = grantedScopes.includes('r_organization_admin');

    // Try to fetch organisations the user admins (only works if r_organization_admin granted)
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

    const account = {
      name: profile.name || 'LinkedIn Account',
      email: profile.email || '',
      picture: profile.picture || '',
      sub: profile.sub || '',
      memberUrn: profile.sub ? `urn:li:person:${profile.sub}` : '',
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      scopes: grantedScopes,
      capabilities: {
        signIn: true,
        postPersonal: canPostPersonal,
        postCompany: canPostCompany,
        listOrganisations: canListOrgs,
      },
      organisations,
      connectedAt: new Date().toISOString(),
    };

    return NextResponse.redirect(
      new URL(
        '/channels?li_connected=true&li_account=' + encodeURIComponent(JSON.stringify(account)),
        req.url
      )
    );
  } catch (err) {
    console.error('LinkedIn OAuth error:', err);
    return NextResponse.redirect(new URL('/channels?li_error=server_error', req.url));
  }
}
