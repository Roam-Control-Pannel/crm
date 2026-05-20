import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const META_STORE = 'roam-brain';
const ITEMS_KEY = 'items';
const FOLDERS_KEY = 'folders';

interface Item {
  id: string; blobId: string; folderId: string | null;
  tags: string[]; description: string; mime: string; size: number; uploadedAt: string;
}

interface Folder { id: string; name: string }

/**
 * Search Brain items by description and tags.
 *
 * Query params:
 *   q       free-text matched against description + tags
 *   tags    comma-separated, all must match (case-insensitive)
 *   folder  folder name OR id; restricts to a folder
 *   type    'document' | 'image' | 'all' (default 'all'). 'document' covers
 *           markdown + PDF + any non-image mime.
 *   limit   default 20, max 100
 *
 * Returns metadata only (no content). Use /api/brain/items/[id]/content to
 * pull the body of a single item — keeps the search response small even
 * when there are dozens of matches.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const tagFilter = (url.searchParams.get('tags') || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const folder = (url.searchParams.get('folder') || '').trim();
    const type = (url.searchParams.get('type') || 'all').toLowerCase();
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));

    const items = await getItems();
    const folders = await getFolders();

    // Resolve folder filter to an ID (accepts name or id).
    let folderId: string | null = null;
    if (folder) {
      const direct = folders.find(f => f.id === folder);
      const byName = folders.find(f => f.name.toLowerCase() === folder.toLowerCase());
      folderId = direct?.id || byName?.id || null;
      if (!folderId) {
        return NextResponse.json({ ok: true, count: 0, items: [], hint: `No folder matched "${folder}"` });
      }
    }

    const folderName = (id: string | null) => id ? (folders.find(f => f.id === id)?.name || null) : null;

    const matched = items
      .filter(i => {
        if (folderId && i.folderId !== folderId) return false;
        if (type === 'image' && !i.mime?.startsWith('image/')) return false;
        if (type === 'document' && i.mime?.startsWith('image/')) return false;
        if (tagFilter.length > 0) {
          const itemTags = (i.tags || []).map(t => t.toLowerCase());
          for (const t of tagFilter) if (!itemTags.includes(t)) return false;
        }
        if (q) {
          const hay = `${i.description || ''} ${(i.tags || []).join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      // Newest first — chat tool wants recent context to surface.
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, limit)
      .map(i => ({
        id: i.id,
        description: i.description,
        tags: i.tags,
        mime: i.mime,
        size: i.size,
        uploadedAt: i.uploadedAt,
        folder: folderName(i.folderId),
        url: `/api/images/${i.blobId}`,
      }));

    return NextResponse.json({ ok: true, count: matched.length, items: matched });
  } catch (err: any) {
    console.error('brain search error:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Search failed' }, { status: 500 });
  }
}

async function getItems(): Promise<Item[]> {
  try {
    const store = getStore(META_STORE);
    return ((await store.get(ITEMS_KEY, { type: 'json' })) as Item[]) || [];
  } catch { return []; }
}

async function getFolders(): Promise<Folder[]> {
  try {
    const store = getStore(META_STORE);
    return ((await store.get(FOLDERS_KEY, { type: 'json' })) as Folder[]) || [];
  } catch { return []; }
}
