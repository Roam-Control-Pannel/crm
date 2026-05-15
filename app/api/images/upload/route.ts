import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

export const dynamic = 'force-dynamic';

const STORE_NAME = 'roam-uploads';

// 10 MB ceiling — large enough for high-res photos, small enough that a
// runaway client can't fill the blob store. Bump if a legitimate use case
// needs more.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Explicit allowlist. We're an image uploader; anything else (PDFs, SVGs
// which can carry script, executables) gets rejected at the boundary.
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

/**
 * Accept a multipart file upload, store in Netlify Blobs, return retrieval URL.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` },
        { status: 413 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ ok: false, error: 'Empty file' }, { status: 400 });
    }

    // Generate a stable ID
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';

    if (!ALLOWED_MIME.has(file.type) || !ALLOWED_EXTS.has(ext)) {
      return NextResponse.json(
        { ok: false, error: 'Unsupported file type — JPEG, PNG, WEBP, or GIF only' },
        { status: 415 }
      );
    }

    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;

    // Store in Netlify Blobs (binary)
    const store = getStore(STORE_NAME);
    const arrayBuffer = await file.arrayBuffer();
    await store.set(id, arrayBuffer, {
      metadata: {
        originalName: file.name,
        contentType: file.type || 'image/jpeg',
        size: file.size,
        uploadedAt: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      ok: true,
      id,
      url: `/api/images/${id}`,
      contentType: file.type,
      size: file.size,
    });
  } catch (err: any) {
    console.error('image upload error:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Upload failed' }, { status: 500 });
  }
}
