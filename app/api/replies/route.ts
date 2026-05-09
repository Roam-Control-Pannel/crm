import { NextRequest, NextResponse } from 'next/server';
import { listRepliesForContact, recentReplies } from '@/lib/replies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Read API for stored replies.
 *
 *   GET /api/replies?email=foo@bar.com   -> array of replies for that contact
 *   GET /api/replies?recent=20           -> recent replies across all contacts
 *
 * Auth: this endpoint is NOT in the public route allow-list, so it sits
 * behind the NextAuth middleware. UI calls it from logged-in pages only.
 */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email');
  const recent = searchParams.get('recent');

  try {
    if (email) {
      const replies = await listRepliesForContact(email);
      return NextResponse.json({ ok: true, replies });
    }
    if (recent) {
      const limit = Math.min(Math.max(parseInt(recent, 10) || 20, 1), 100);
      const replies = await recentReplies(limit);
      return NextResponse.json({ ok: true, replies });
    }
    return NextResponse.json(
      { error: 'Provide ?email=X or ?recent=N' },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('[replies] GET failed:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to read replies' },
      { status: 500 }
    );
  }
}
