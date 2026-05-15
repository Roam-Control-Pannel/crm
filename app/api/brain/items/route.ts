import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

export const dynamic = 'force-dynamic';

const META_STORE = 'roam-brain';
const BLOB_STORE = 'roam-uploads';
const ITEMS_KEY = 'items';
const FOLDERS_KEY = 'folders';

// Default folder name for Roam-io chat saves. Auto-created on first use.
const ROAMIO_SAVES_FOLDER = 'Roam-io saves';

export interface Item {
  id: string;
  blobId: string;          // key in roam-uploads store
  folderId: string | null;
  tags: string[];
  description: string;
  mime: string;
  size: number;
  uploadedAt: string;
}

async function getItems(): Promise<Item[]> {
  try {
    const store = getStore(META_STORE);
    return ((await store.get(ITEMS_KEY, { type: 'json' })) as Item[]) || [];
  } catch { return []; }
}
async function setItems(items: Item[]) {
  await getStore(META_STORE).set(ITEMS_KEY, JSON.stringify(items));
}

/**
 * Use Claude Sonnet vision to generate tags + description for an image.
 * Returns { tags: string[], description: string }
 */
async function autoTagImage(base64: string, mediaType: string): Promise<{ tags: string[]; description: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { tags: [], description: '' };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              {
                type: 'text',
                text: `Look at this image and return JSON only:
{"tags": ["tag1","tag2","tag3"], "description": "one short sentence describing the image"}

Tags: 3-6 short, lowercase, kebab-case keywords describing the subject, location, mood, content type. Useful for searching ("high-street", "exterior", "evening", "people-eating", "landscape", "logo", "team-photo"). Avoid generic tags like "image" or "photo".

Description: one factual sentence under 100 chars.

Return ONLY the JSON, no markdown, no preamble.`,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[autoTag] anthropic ${res.status}: ${body.slice(0, 200)}`);
      return { tags: [], description: '' };
    }
    const data = await res.json();
    const txt: string = data.content?.[0]?.text || '';
    const cleaned = txt.replace(/```json|```/g, '').trim();
    if (!cleaned) return { tags: [], description: '' };
    const parsed = JSON.parse(cleaned);
    return {
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8) : [],
      description: typeof parsed.description === 'string' ? parsed.description.slice(0, 200) : '',
    };
  } catch (e) {
    console.error('autoTag failed', e);
    return { tags: [], description: '' };
  }
}

// =================================================================
// Folder helpers — used by JSON save branch to land items in
// "Roam-io saves" (auto-created on first save).
// =================================================================
interface Folder { id: string; name: string; parentId: string | null; createdAt: string; }

async function getFolders(): Promise<Folder[]> {
  try {
    const store = getStore(META_STORE);
    const data = await store.get(FOLDERS_KEY, { type: 'json' });
    return (data as Folder[]) || [];
  } catch { return []; }
}

async function setFolders(folders: Folder[]): Promise<void> {
  const store = getStore(META_STORE);
  await store.set(FOLDERS_KEY, JSON.stringify(folders));
}

/**
 * Find a folder by exact name (case-insensitive). If missing, create it
 * at root and return the new folder.
 */
async function findOrCreateFolder(name: string): Promise<Folder> {
  const folders = await getFolders();
  const existing = folders.find(f => f.name.toLowerCase() === name.toLowerCase() && !f.parentId);
  if (existing) return existing;
  const folder: Folder = {
    id: 'fld_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name,
    parentId: null,
    createdAt: new Date().toISOString(),
  };
  folders.push(folder);
  await setFolders(folders);
  return folder;
}

/**
 * Smart-match: given a list of tags + the content body, find an existing
 * folder whose name appears in either. Returns null if no clear match.
 * Currently used as a NO-OP fallback — Patch 2 ships with auto-foldering
 * disabled per the agreed scope (single "Roam-io saves" folder), but the
 * helper is here so Patch 4 / future work can flip it on.
 */
async function smartMatchFolder(content: string, tags: string[]): Promise<Folder | null> {
  const folders = await getFolders();
  if (folders.length === 0) return null;
  const haystack = (content + ' ' + tags.join(' ')).toLowerCase();
  for (const f of folders) {
    const needle = f.name.toLowerCase();
    if (needle === ROAMIO_SAVES_FOLDER.toLowerCase()) continue;
    if (needle.length < 4) continue; // avoid matching tiny folder names spuriously
    if (haystack.includes(needle)) return f;
  }
  return null;
}

/**
 * GET — list all items, optional ?folderId= filter (use 'root' for items with no folder)
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const folderId = url.searchParams.get('folderId');
    let items = await getItems();
    if (folderId === 'root') {
      items = items.filter(i => !i.folderId);
    } else if (folderId) {
      items = items.filter(i => i.folderId === folderId);
    }
    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

/**
 * POST — two branches:
 *
 *  A) multipart/form-data: file upload. Stores binary in roam-uploads,
 *     metadata in roam-brain. Auto-tags via Claude vision (images only).
 *
 *  B) application/json: text save (used by Roam-io chat save-to-Brain).
 *     Body: { content, tags?, description?, source?, autoFolder?,
 *             contextBefore?, contextAfter? }
 *     Stores the text as a blob with content-type text/markdown so the
 *     brain page preview iframe can render it.
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return handleJsonSave(req);
  }
  return handleFileUpload(req);
}

async function handleFileUpload(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    let folderId = (formData.get('folderId') as string | null) || null;
    // New: callers can pass a folder NAME (e.g. "Roam-io attachments") and
    // we auto-create it if missing. Keeps client code free of folder IDs.
    const folderName = (formData.get('folderName') as string | null) || null;
    // New: an extra tag merged with whatever auto-tagging produces. Used
    // by the Roam-io chat image flow to mark attachments as such.
    const extraTag = (formData.get('extraTag') as string | null) || null;

    if (!file) {
      return NextResponse.json({ ok: false, error: 'No file' }, { status: 400 });
    }

    // Resolve folderName → folderId if provided and no explicit folderId.
    if (!folderId && folderName) {
      const folder = await findOrCreateFolder(folderName);
      folderId = folder.id;
    }

    // 1. Store binary
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const blobId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const blobStore = getStore(BLOB_STORE);
    const arrayBuffer = await file.arrayBuffer();
    await blobStore.set(blobId, arrayBuffer, {
      metadata: {
        originalName: file.name,
        contentType: file.type || 'image/jpeg',
        size: file.size,
        uploadedAt: new Date().toISOString(),
      },
    });

    // 2. AI auto-tag (images only — Claude vision can't read PDFs as base64 image)
    const mediaType = file.type || 'application/octet-stream';
    let tags: string[] = [];
    let description = '';
    if (mediaType.startsWith('image/')) {
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const result = await autoTagImage(base64, mediaType);
      tags = result.tags;
      description = result.description;
    }

    // Merge extra tag if provided, dedupe.
    if (extraTag) {
      tags = Array.from(new Set([...tags, extraTag]));
    }

    // 3. Save metadata to brain store
    const item: Item = {
      id: 'itm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      blobId,
      folderId,
      tags,
      description,
      mime: mediaType,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    };
    const items = await getItems();
    items.push(item);
    await setItems(items);

    return NextResponse.json({ ok: true, item, url: `/api/images/${blobId}` });
  } catch (err: any) {
    console.error('brain upload error:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Upload failed' }, { status: 500 });
  }
}

async function handleJsonSave(req: NextRequest) {
  try {
    const body = await req.json();
    const content: string = (body.content || '').toString();
    if (!content.trim()) {
      return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });
    }
    if (content.length > 200_000) {
      return NextResponse.json({ ok: false, error: 'content too large (200kb max)' }, { status: 400 });
    }

    const tags: string[] = Array.isArray(body.tags) ? body.tags.slice(0, 12) : [];
    const description: string = (body.description || '').toString().slice(0, 300);
    const source: string = (body.source || 'roam-io-chat').toString();
    const autoFolder: boolean = body.autoFolder !== false; // default true
    let folderId: string | null = body.folderId || null;
    const contextBefore: string = (body.contextBefore || '').toString();
    const contextAfter: string = (body.contextAfter || '').toString();

    // Resolve folder. autoFolder = true means: try smartMatchFolder, fall
    // back to "Roam-io saves". Caller can pass explicit folderId to skip
    // routing entirely.
    if (!folderId && autoFolder) {
      const matched = await smartMatchFolder(content, tags);
      const folder = matched || (await findOrCreateFolder(ROAMIO_SAVES_FOLDER));
      folderId = folder.id;
    }

    // Compose final body — wrap context if present so the saved item is
    // self-explanatory when viewed later.
    let composed = content;
    if (contextBefore || contextAfter) {
      const parts: string[] = [];
      if (contextBefore) parts.push('---\n**Context before:**\n\n' + contextBefore);
      parts.push((contextBefore || contextAfter ? '---\n**Saved:**\n\n' : '') + content);
      if (contextAfter) parts.push('---\n**Context after:**\n\n' + contextAfter);
      composed = parts.join('\n\n');
    }

    // Store as a markdown blob so the brain preview iframe renders it.
    const blobId = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.md`;
    const blobStore = getStore(BLOB_STORE);
    await blobStore.set(blobId, composed, {
      metadata: {
        originalName: `${source}.md`,
        contentType: 'text/markdown',
        size: composed.length,
        uploadedAt: new Date().toISOString(),
      },
    });

    // Compose description if not provided — first ~140 chars of content.
    const finalDescription = description || content.trim().split('\n')[0].slice(0, 140);
    // Always tag with the source so future retrieval can filter to chat saves.
    const finalTags = Array.from(new Set([...tags, source]));

    const item: Item = {
      id: 'itm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      blobId,
      folderId,
      tags: finalTags,
      description: finalDescription,
      mime: 'text/markdown',
      size: composed.length,
      uploadedAt: new Date().toISOString(),
    };
    const items = await getItems();
    items.push(item);
    await setItems(items);

    return NextResponse.json({ ok: true, item, url: `/api/images/${blobId}` });
  } catch (err: any) {
    console.error('brain JSON save error:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Save failed' }, { status: 500 });
  }
}
