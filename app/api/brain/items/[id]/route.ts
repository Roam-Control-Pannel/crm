import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
// BRAIN-STORE-V1: the index accessors are shared and fail closed. The local
// copies this file used to carry returned [] on a read failure, so a PATCH
// or DELETE landing during a Blobs blip rewrote the whole index.
import { getItems, setItems } from '@/lib/brain-store';
import { readErrorResponse } from '@/lib/store-read';

export const dynamic = 'force-dynamic';

const BLOB_STORE = 'roam-uploads';

/**
 * NEXT16-ASYNC-PARAMS-V1: `params` is a Promise from Next 15 onward, so each
 * handler awaits it once and uses the resolved object. Destructuring it in
 * the signature as before now yields a Promise and every read is undefined.
 */
interface RouteParams { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  try {
    const { tags, description, folderId } = await req.json();
    const items = await getItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 });
    if (Array.isArray(tags)) items[idx].tags = tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 12);
    if (typeof description === 'string') items[idx].description = description.slice(0, 300);
    if (folderId !== undefined) items[idx].folderId = folderId || null;
    await setItems(items);
    return NextResponse.json({ ok: true, item: items[idx] });
  } catch (err: any) {
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  try {
    const items = await getItems();
    const item = items.find(i => i.id === id);
    if (!item) return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 });

    // Remove the binary
    try { await getStore(BLOB_STORE).delete(item.blobId); } catch (e) { console.warn('blob delete failed', e); }

    // Remove the metadata
    await setItems(items.filter(i => i.id !== id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
