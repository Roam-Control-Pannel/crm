import { NextResponse } from 'next/server';
import { getUserTokens, DEFAULT_USER_ID } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

/**
 * Real account shape — what the Social Accounts page consumes.
 * Each entry represents a single real posting destination.
 */
export interface RealAccount {
  id: string;                    // stable: 'li-personal:{memberUrn}', 'meta-page:{pageId}', 'meta-ig:{igId}'
  platform: 'linkedin' | 'facebook' | 'instagram';
  type: 'personal' | 'company' | 'page';
  handle: string;                // display name
  region?: string;
  capabilities: { canPost: boolean };
  pendingApproval?: boolean;     // true for LI Company while Community Mgmt API not approved
  meta?: {                       // extra platform-specific data
    memberUrn?: string;          // LinkedIn personal
    pageId?: string;             // Meta page
    instagramId?: string;        // IG Business linked to Meta page
    organizationUrn?: string;    // LinkedIn company
  };
}

/**
 * Returns connection status for all providers, plus a flat realAccounts[]
 * array of every real platform account we can publish to.
 */
export async function GET() {
  try {
    const tokens = await getUserTokens(DEFAULT_USER_ID);

    // Existing shape (backward compatible) — Channels page still uses this
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

    // New: flat array of real publishable accounts
    const realAccounts: RealAccount[] = [];

    // LinkedIn personal
    if (tokens.linkedin && tokens.linkedin.expiresAt > Date.now()) {
      const canPost = !!tokens.linkedin.capabilities?.canPostAsPerson;
      realAccounts.push({
        id: `li-personal:${tokens.linkedin.memberUrn}`,
        platform: 'linkedin',
        type: 'personal',
        handle: tokens.linkedin.name,
        region: 'UK',
        capabilities: { canPost },
        meta: { memberUrn: tokens.linkedin.memberUrn },
      });

      // LinkedIn organisations (company pages) — pending until Community Mgmt API approval
      const orgs = tokens.linkedin.organisations || [];
      for (const org of orgs) {
        const canPostAsOrg = !!tokens.linkedin.capabilities?.canPostAsOrg;
        realAccounts.push({
          id: `li-company:${org.urn}`,
          platform: 'linkedin',
          type: 'company',
          handle: org.name || 'LinkedIn Company',
          region: 'UK',
          capabilities: { canPost: canPostAsOrg },
          pendingApproval: !canPostAsOrg,
          meta: { organizationUrn: org.urn },
        });
      }

      // If no org admin scope yet, surface the pending Roam company page placeholder
      // so the user sees it and knows it's coming
      if (!tokens.linkedin.capabilities?.canPostAsOrg && orgs.length === 0) {
        realAccounts.push({
          id: 'li-company:pending',
          platform: 'linkedin',
          type: 'company',
          handle: 'LinkedIn Company Page',
          region: 'UK',
          capabilities: { canPost: false },
          pendingApproval: true,
        });
      }
    }

    // Meta pages — each page = one Facebook account, plus optional Instagram account
    if (tokens.meta && tokens.meta.expiresAt > Date.now()) {
      for (const page of tokens.meta.pages || []) {
        realAccounts.push({
          id: `meta-page:${page.id}`,
          platform: 'facebook',
          type: 'page',
          handle: page.name,
          capabilities: { canPost: true },
          meta: { pageId: page.id },
        });

        if (page.instagramId) {
          realAccounts.push({
            id: `meta-ig:${page.instagramId}`,
            platform: 'instagram',
            type: 'page',
            handle: `${page.name} (IG)`,
            capabilities: { canPost: true },
            meta: { pageId: page.id, instagramId: page.instagramId },
          });
        }
      }
    }

    return NextResponse.json({ linkedin, meta, realAccounts });
  } catch (err: any) {
    console.error('accounts/status error:', err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
