import { NextRequest, NextResponse } from 'next/server';
import { deleteProviderTokens, DEFAULT_USER_ID } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

/**
 * POST /api/accounts/disconnect
 * Body: { provider: 'linkedin' | 'meta' }
 */
export async function POST(req: NextRequest) {
  try {
    const { provider } = await req.json();

    if (provider !== 'linkedin' && provider !== 'meta') {
      return NextResponse.json(
        { error: 'Invalid provider. Must be "linkedin" or "meta".' },
        { status: 400 }
      );
    }

    await deleteProviderTokens(DEFAULT_USER_ID, provider);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('accounts/disconnect error:', err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
