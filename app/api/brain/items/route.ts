import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
import sharp from 'sharp';
import {
  MAX_UPLOAD_BYTES,
  JPEG_QUALITY,
  classifyUpload,
  storedContentTypeFor,
  storedExtensionFor,
} from '@/lib/uploads';
// BRAIN-STORE-V1: shared, fail-closed index accessors. This route is the
// worst case for the old swallow-as-[] behaviour: both branches of POST are
// read-append-write, so one failed read during an upload replaced the entire
// Brain index with the single item being added.
import {
  getItems,
  setItems,
  getFolders,
  setFolders,
  type Item,
  type Folder,
} from '@/lib/brain-store';
import { readErrorResponse } from '@/lib/store-read';

export type { Item };

export const dynamic = 'force-dynamic';
// sharp is a native module — pin this route to the Node runtime so the
// transcode in handleFileUpload isn't bundled for Edge.
export const runtime = 'nodejs';

const BLOB_STORE = 'roam-uploads';

// Default folder name for Roam-io chat saves. Auto-created on first use.
const ROAMIO_SAVES_FOLDER = 'Roam-io saves';

function composeUrlMarkdown(url: string, title: string | undefined, body: string): string {
  // Stored body for URL items — keeps the link prominently in the doc so
  // anyone reading it later (including the AI) sees where it came from.
  const heading = title || url;
  const meta = `_Source:_ [${url}](${url})  · _Scraped:_ ${new Date().toISOString().slice(0, 10)}`;
  return `# ${heading}\n\n${meta}\n\n${body.trim()}`;
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
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
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

    // UPLOAD-POLICY-V1
    // This route writes into the same roam-uploads store that the public
    // /api/images/[id] reader serves from, so it enforces the same policy
    // as the sibling uploader at /api/images/upload. Previously it took the
    // extension from file.name and persisted `file.type` verbatim with no
    // allowlist and no size cap, which meant an upload declared as
    // text/html was served back as HTML on our own origin, cached for a
    // year, on a path middleware serves without a session.
    //
    // Bounds are checked before the body is buffered: file.size comes from
    // the multipart part header, so an oversized upload is rejected without
    // us materialising it (and, for images, without base64-ing it for the
    // vision call).
    if (file.size === 0) {
      return NextResponse.json({ ok: false, error: 'Empty file' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` },
        { status: 413 }
      );
    }

    const kind = classifyUpload(file.name, file.type);
    if (!kind) {
      return NextResponse.json(
        { ok: false, error: 'Unsupported file type — images, PDF, Markdown or plain text only' },
        { status: 415 }
      );
    }

    // Resolve folderName → folderId if provided and no explicit folderId.
    if (!folderId && folderName) {
      const folder = await findOrCreateFolder(folderName);
      folderId = folder.id;
    }

    // 1. Store binary.
    // IMAGE-NORMALISE-V1: images are transcoded to JPEG at the boundary so
    // every downstream consumer (Instagram in particular, which rejects
    // anything else) gets a format it accepts. Matches what
    // /api/images/upload already does; Brain images feed the same social
    // publish path via /api/social/draft and lib/social-cron.
    const sourceBuffer = Buffer.from(await file.arrayBuffer());
    let storedBuffer: Buffer = sourceBuffer;
    if (kind === 'image') {
      try {
        storedBuffer = await sharp(sourceBuffer)
          .rotate() // auto-orient via EXIF before sharp strips it
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
          .toBuffer();
      } catch (transcodeErr: any) {
        console.error('[brain upload] transcode failed:', transcodeErr);
        return NextResponse.json(
          { ok: false, error: 'Image transcoding failed — file may be corrupt or an unsupported variant' },
          { status: 422 }
        );
      }
    }

    // The persisted content type is always server-derived, never the
    // caller's. /api/images/[id] clamps what it will serve to the same
    // allowlist, so the two ends agree.
    const mediaType = storedContentTypeFor(kind, file.name);
    const ext = storedExtensionFor(kind, file.name);
    const blobId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const blobStore = getStore(BLOB_STORE);
    const storedArrayBuffer = storedBuffer.buffer.slice(
      storedBuffer.byteOffset,
      storedBuffer.byteOffset + storedBuffer.byteLength
    ) as ArrayBuffer;
    await blobStore.set(blobId, storedArrayBuffer, {
      metadata: {
        originalName: file.name,
        originalContentType: file.type || 'unknown',
        originalSize: file.size,
        contentType: mediaType,
        size: storedBuffer.length,
        uploadedAt: new Date().toISOString(),
        ...(kind === 'image' ? { normalised: 'jpeg-v1' } : {}),
      },
    });

    // 2. AI auto-tag (images only — Claude vision can't read PDFs as base64 image)
    let tags: string[] = [];
    let description = '';
    if (kind === 'image') {
      const base64 = storedBuffer.toString('base64');
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
      size: storedBuffer.length,
      uploadedAt: new Date().toISOString(),
    };
    const items = await getItems();
    items.push(item);
    await setItems(items);

    return NextResponse.json({ ok: true, item, url: `/api/images/${blobId}` });
  } catch (err: any) {
    console.error('brain upload error:', err);
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

async function handleJsonSave(req: NextRequest) {
  try {
    const body = await req.json();

    // URL save flow: when a sourceUrl is provided, scrape it server-side
    // and use the result as the body. The user can also pass `content`
    // explicitly to override the scraped text (e.g. they pasted their own
    // summary).
    let sourceUrl: string | undefined;
    let scrapedTitle: string | undefined;
    if (typeof body.url === 'string' && body.url.trim()) {
      sourceUrl = body.url.trim();
      if (!body.content) {
        const { scrapeUrl } = await import('@/lib/scrape');
        const scraped = await scrapeUrl(sourceUrl);
        if (!scraped.ok) {
          return NextResponse.json({ ok: false, error: scraped.error || 'Scrape failed', sourceUrl }, { status: 422 });
        }
        body.content = composeUrlMarkdown(sourceUrl, scraped.title, scraped.text || '');
        scrapedTitle = scraped.title;
      }
    }

    const content: string = (body.content || '').toString();
    if (!content.trim()) {
      return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 });
    }
    if (content.length > 200_000) {
      return NextResponse.json({ ok: false, error: 'content too large (200kb max)' }, { status: 400 });
    }

    const tags: string[] = Array.isArray(body.tags) ? body.tags.slice(0, 12) : [];
    const description: string = (body.description || scrapedTitle || '').toString().slice(0, 300);
    const source: string = (body.source || (sourceUrl ? 'roam-io-url' : 'roam-io-chat')).toString();
    const autoFolder: boolean = body.autoFolder !== false; // default true
    let folderId: string | null = body.folderId || null;
    const folderName: string | null = body.folderName || (sourceUrl ? 'Roam-io documents' : null);
    const contextBefore: string = (body.contextBefore || '').toString();
    const contextAfter: string = (body.contextAfter || '').toString();

    // Resolve folder. Precedence:
    //   1. explicit folderId
    //   2. explicit folderName -> findOrCreateFolder(name)
    //   3. autoFolder=true (default) -> smart match -> 'Roam-io saves'
    if (!folderId && folderName) {
      const folder = await findOrCreateFolder(folderName);
      folderId = folder.id;
    } else if (!folderId && autoFolder) {
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
    // URL items get an extra `web-source` tag for easier filtering.
    const finalTags = Array.from(new Set([...tags, source, ...(sourceUrl ? ['web-source'] : [])]));

    const item: Item = {
      id: 'itm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      blobId,
      folderId,
      tags: finalTags,
      description: finalDescription,
      mime: 'text/markdown',
      size: composed.length,
      uploadedAt: new Date().toISOString(),
      ...(sourceUrl ? { sourceUrl } : {}),
    };
    const items = await getItems();
    items.push(item);
    await setItems(items);

    return NextResponse.json({ ok: true, item, url: `/api/images/${blobId}` });
  } catch (err: any) {
    console.error('brain JSON save error:', err);
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
