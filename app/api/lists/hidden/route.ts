import { NextRequest, NextResponse } from 'next/server';
import { getHiddenListIds, setListHidden, setHiddenListIds } from '@/lib/hidden-lists';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const hiddenListIds = await getHiddenListIds();
  return NextResponse.json({ hiddenListIds });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const listId = Number(body?.listId);
  const hidden = Boolean(body?.hidden);
  if (!Number.isInteger(listId) || listId < 1) {
    return NextResponse.json({ error: 'invalid listId' }, { status: 400 });
  }
  const hiddenListIds = await setListHidden(listId, hidden);
  return NextResponse.json({ hiddenListIds });
}

/** PUT replaces the full set — used by the Settings page's bulk unhide. */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const incoming = Array.isArray(body?.hiddenListIds) ? body.hiddenListIds.map((n: any) => Number(n)) : null;
  if (!incoming) {
    return NextResponse.json({ error: 'hiddenListIds must be an array' }, { status: 400 });
  }
  const hiddenListIds = await setHiddenListIds(incoming);
  return NextResponse.json({ hiddenListIds });
}
