import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

export const dynamic = 'force-dynamic';

const STORE = 'roam-brain';
const KEY = 'folders';
const ITEMS_KEY = 'items';

interface Folder { id: string; name: string; parentId: string | null; createdAt: string; }
interface Item { id: string; blobId: string; folderId: string | null; tags: string[]; description: string; mime: string; uploadedAt: string; }

async function getFolders(): Promise<Folder[]> {
  try { const store = getStore(STORE); return ((await store.get(KEY, { type: 'json' })) as Folder[]) || []; } catch { return []; }
}
async function setFolders(folders: Folder[]) { await getStore(STORE).set(KEY, JSON.stringify(folders)); }
async function getItems(): Promise<Item[]> {
  try { const store = getStore(STORE); return ((await store.get(ITEMS_KEY, { type: 'json' })) as Item[]) || []; } catch { return []; }
}
async function setItems(items: Item[]) { await getStore(STORE).set(ITEMS_KEY, JSON.stringify(items)); }

interface RouteParams { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { name, parentId } = await req.json();
    const folders = await getFolders();
    const idx = folders.findIndex(f => f.id === params.id);
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Folder not found' }, { status: 404 });

    // Prevent making a folder its own ancestor
    if (parentId !== undefined) {
      let cursor: string | null = parentId;
      while (cursor) {
        if (cursor === params.id) {
          return NextResponse.json({ ok: false, error: 'Cannot move folder into its own descendant' }, { status: 400 });
        }
        cursor = folders.find(f => f.id === cursor)?.parentId || null;
      }
    }

    if (name !== undefined) folders[idx].name = name.trim();
    if (parentId !== undefined) folders[idx].parentId = parentId || null;
    await setFolders(folders);
    return NextResponse.json({ ok: true, folder: folders[idx] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const folders = await getFolders();
    // Find all descendants (recursive)
    const toDelete = new Set<string>();
    function collect(id: string) {
      toDelete.add(id);
      folders.filter(f => f.parentId === id).forEach(c => collect(c.id));
    }
    collect(params.id);

    // Remove folders + their items
    const remaining = folders.filter(f => !toDelete.has(f.id));
    await setFolders(remaining);

    const items = await getItems();
    const survivingItems = items.filter(i => !i.folderId || !toDelete.has(i.folderId));
    await setItems(survivingItems);

    return NextResponse.json({ ok: true, deletedFolders: toDelete.size, deletedItems: items.length - survivingItems.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
