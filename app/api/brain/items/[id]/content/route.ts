import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
// BRAIN-STORE-V1: shared, fail-closed index accessors. Read-only here, but
// "item not found" and "index unreadable" must not look the same to the
// caller — Roam-io reads item bodies through this route.
import { getItems } from '@/lib/brain-store';
import { readErrorResponse } from '@/lib/store-read';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BLOB_STORE = 'roam-uploads';

interface RouteParams { params: { id: string } }

/**
 * Return the full text content of a single Brain item.
 *
 * Used by the `read_brain_item` AI tool and by the Brain page's preview
 * panel. Text/markdown items return their actual content; binary items
 * (PDFs, images) return a stub with the binary URL so the caller can
 * fetch it directly via /api/images/[blobId].
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const items = await getItems();
    const item = items.find(i => i.id === params.id);
    if (!item) {
      return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 });
    }

    const meta = {
      id: item.id,
      description: item.description,
      tags: item.tags,
      mime: item.mime,
      size: item.size,
      uploadedAt: item.uploadedAt,
      folderId: item.folderId,
      url: `/api/images/${item.blobId}`,
      ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
    };

    // Text-ish content → return the body inline so the AI tool can read it
    // in one round-trip. Binary stays out-of-band.
    const isTextish = item.mime === 'text/markdown' || item.mime === 'text/plain' || item.mime.startsWith('text/');
    if (!isTextish) {
      return NextResponse.json({ ok: true, item: meta, binary: true });
    }

    const blob = getStore(BLOB_STORE);
    const content = await blob.get(item.blobId, { type: 'text' });
    return NextResponse.json({ ok: true, item: meta, content: content || '' });
  } catch (err: any) {
    console.error('brain content fetch error:', err);
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

