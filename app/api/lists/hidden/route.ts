import { NextRequest, NextResponse } from 'next/server';
import { getHiddenListIds, setListHidden } from '@/lib/hidden-lists';

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
