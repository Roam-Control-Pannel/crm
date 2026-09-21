import { NextRequest, NextResponse } from 'next/server';
// BRAIN-STORE-V1: shared, fail-closed index accessors. Folder delete reads
// BOTH the folder list and the item index before writing both back, so the
// old swallow-as-[] behaviour could wipe either one.
import { getFolders, setFolders, getItems, setItems, type Folder, type Item } from '@/lib/brain-store';
import { readErrorResponse } from '@/lib/store-read';

export const dynamic = 'force-dynamic';

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
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
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
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
