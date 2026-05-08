import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

export const dynamic = 'force-dynamic';

const META_STORE = 'roam-brain';
const BLOB_STORE = 'roam-uploads';
const ITEMS_KEY = 'items';

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

    const data = await res.json();
    const txt = data.content?.[0]?.text || '';
    const cleaned = txt.replace(/```json|```/g, '').trim();
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
 * POST — multipart file upload. Stores binary in roam-uploads, metadata in roam-brain.
 * Auto-tags via Claude vision.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const folderId = (formData.get('folderId') as string | null) || null;

    if (!file) {
      return NextResponse.json({ ok: false, error: 'No file' }, { status: 400 });
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

    // 2. AI auto-tag
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mediaType = file.type || 'image/jpeg';
    const { tags, description } = await autoTagImage(base64, mediaType);

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
