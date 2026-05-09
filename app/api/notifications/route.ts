import { NextRequest, NextResponse } from 'next/server';
import { listNotifications, addNotification, markRead, unreadCount } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET    /api/notifications              → list + unread count
 * POST   /api/notifications              → add (used by client-side actions)
 * PUT    /api/notifications              → mark read; body { ids: string[] | 'all' }
 */

export async function GET() {
  try {
    const [notifications, unread] = await Promise.all([
      listNotifications(),
      unreadCount(),
    ]);
    return NextResponse.json({ notifications, unread });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.type || !body?.title) {
      return NextResponse.json({ error: 'type and title required' }, { status: 400 });
    }
    const notif = await addNotification({
      type: body.type,
      title: body.title,
      body: body.body || '',
      contactEmail: body.contactEmail,
      href: body.href,
      dedupeKey: body.dedupeKey,
    });
    return NextResponse.json({ notification: notif });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const ids = body?.ids;
    if (ids !== 'all' && !Array.isArray(ids)) {
      return NextResponse.json({ error: 'ids must be array or "all"' }, { status: 400 });
    }
    await markRead(ids);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}
