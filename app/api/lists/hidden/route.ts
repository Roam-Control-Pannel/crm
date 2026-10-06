import { NextRequest, NextResponse } from 'next/server';
import { getHiddenListIds, setListHidden, setHiddenListIds } from '@/lib/hidden-lists';
import { readErrorResponse } from '@/lib/store-read';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * HIDDEN-LISTS-ERRORS-V1
 *
 * This was the only blob-backed route in the app with no error handling at
 * all. getHiddenListIds throws StoreReadError by the fail-closed contract, so
 * under a Blobs outage this route returned Next's HTML 500 while /api/settings,
 * /api/brain/items and /api/brain/folders all returned a clean JSON 503 — and
 * the Settings page's res.json() died on `Unexpected token '<'` instead of
 * showing the retryable message it already knows how to show.
 *
 * readErrorResponse gives every handler here the same shape as its siblings:
 * 503 and retryable for a read that failed, 500 otherwise.
 */
export async function GET() {
  try {
    const hiddenListIds = await getHiddenListIds();
    return NextResponse.json({ hiddenListIds });
  } catch (err) {
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const listId = Number(body?.listId);
  const hidden = Boolean(body?.hidden);
  if (!Number.isInteger(listId) || listId < 1) {
    return NextResponse.json({ error: 'invalid listId' }, { status: 400 });
  }
  try {
    const hiddenListIds = await setListHidden(listId, hidden);
    return NextResponse.json({ hiddenListIds });
  } catch (err) {
    const { body: errBody, status } = readErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}

/** PUT replaces the full set — used by the Settings page's bulk unhide. */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const incoming = Array.isArray(body?.hiddenListIds) ? body.hiddenListIds.map((n: any) => Number(n)) : null;
  if (!incoming) {
    return NextResponse.json({ error: 'hiddenListIds must be an array' }, { status: 400 });
  }
  try {
    const hiddenListIds = await setHiddenListIds(incoming);
    return NextResponse.json({ hiddenListIds });
  } catch (err) {
    // The write used to be swallowed in lib/hidden-lists, so a failed bulk
    // unhide answered 200 with the new array and the next dashboard load
    // quietly hid every town again. It throws now, and this reports it.
    const { body: errBody, status } = readErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
