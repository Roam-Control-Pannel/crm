import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

export const dynamic = 'force-dynamic';

const META_STORE = 'roam-brain';
const BLOB_STORE = 'roam-uploads';
const ITEMS_KEY = 'items';

interface Item {
  id: string; blobId: string; folderId: string | null;
  tags: string[]; description: string; mime: string; size: number; uploadedAt: string;
}

async function getItems(): Promise<Item[]> {
  try { const store = getStore(META_STORE); return ((await store.get(ITEMS_KEY, { type: 'json' })) as Item[]) || []; } catch { return []; }
}
async function setItems(items: Item[]) { await getStore(META_STORE).set(ITEMS_KEY, JSON.stringify(items)); }

interface RouteParams { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { tags, description, folderId } = await req.json();
    const items = await getItems();
    const idx = items.findIndex(i => i.id === params.id);
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 });
    if (Array.isArray(tags)) items[idx].tags = tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 12);
    if (typeof description === 'string') items[idx].description = description.slice(0, 300);
    if (folderId !== undefined) items[idx].folderId = folderId || null;
    await setItems(items);
    return NextResponse.json({ ok: true, item: items[idx] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const items = await getItems();
    const item = items.find(i => i.id === params.id);
    if (!item) return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 });

    // Remove the binary
    try { await getStore(BLOB_STORE).delete(item.blobId); } catch (e) { console.warn('blob delete failed', e); }

    // Remove the metadata
    await setItems(items.filter(i => i.id !== params.id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
