import { NextResponse } from 'next/server';
import { getUserTokens, DEFAULT_USER_ID } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

/**
 * Returns connection status for all providers, with sensitive fields stripped.
 * The Channels page UI uses this to render its state.
 */
export async function GET() {
  try {
    const tokens = await getUserTokens(DEFAULT_USER_ID);

    const linkedin = tokens.linkedin
      ? {
          connected: true,
          name: tokens.linkedin.name,
          email: tokens.linkedin.email,
          picture: tokens.linkedin.picture,
          memberUrn: tokens.linkedin.memberUrn,
          scopes: tokens.linkedin.scopes,
          capabilities: tokens.linkedin.capabilities,
          organisations: tokens.linkedin.organisations || [],
          connectedAt: tokens.linkedin.connectedAt,
          expiresAt: tokens.linkedin.expiresAt,
          isExpired: tokens.linkedin.expiresAt < Date.now(),
        }
      : { connected: false };

    const meta = tokens.meta
      ? {
          connected: true,
          pages: (tokens.meta.pages || []).map(p => ({
            id: p.id,
            name: p.name,
            hasInstagram: !!p.instagramId,
            instagramId: p.instagramId,
          })),
          connectedAt: tokens.meta.connectedAt,
          expiresAt: tokens.meta.expiresAt,
          isExpired: tokens.meta.expiresAt < Date.now(),
        }
      : { connected: false };

    return NextResponse.json({ linkedin, meta });
  } catch (err: any) {
    console.error('accounts/status error:', err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
