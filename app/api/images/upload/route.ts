import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

// IMAGE-NORMALISE-V1
// Instagram's Graph API only accepts JPEG for image containers — PNG /
// WebP / GIF all fail with error 36001 (subcode 2207083 in our case,
// 2207005 in the documented variant). Earlier theory that this was an
// Unsplash WebP issue was incomplete: user-uploaded PNGs hit the same
// wall because they're served from our own domain at their original
// content-type.
//
// Rather than convert per-platform at publish time (which would mean
// touching three different code paths and re-encoding on every cron
// tick), we normalise at the boundary. Every upload becomes JPEG before
// it lands in the blob store, so every downstream consumer gets a
// format Instagram accepts. The original file extension and content-
// type are discarded.
//
// JPEG quality 85 is the "good enough for social" sweet spot — matches
// Unsplash's `urls.regular` default. flatten() against white because
// IG flattens transparency to black by default; white is closer to
// what most users expect when uploading a logo or graphic.
const JPEG_QUALITY = 85;

/**
 * Accept a multipart file upload, transcode to JPEG, store in Netlify
 * Blobs, return retrieval URL.
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

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';

    if (!ALLOWED_MIME.has(file.type) || !ALLOWED_EXTS.has(ext)) {
      return NextResponse.json(
        { ok: false, error: 'Unsupported file type — JPEG, PNG, WEBP, or GIF only' },
        { status: 415 }
      );
    }

    const sourceBuffer = Buffer.from(await file.arrayBuffer());

    // IMAGE-NORMALISE-V1: transcode to JPEG so Instagram (and any other
    // strict-format consumer) is happy. Flatten transparency to white.
    // We don't strip metadata aggressively here — sharp by default
    // drops EXIF anyway, which is what we want for social uploads.
    let jpegBuffer: Buffer;
    try {
      jpegBuffer = await sharp(sourceBuffer)
        .rotate() // auto-orient via EXIF before we strip it
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    } catch (transcodeErr: any) {
      console.error('[image upload] transcode failed:', transcodeErr);
      return NextResponse.json(
        { ok: false, error: 'Image transcoding failed — file may be corrupt or unsupported variant' },
        { status: 422 }
      );
    }

    // Generate a stable ID. Extension is now always .jpg because that's
    // what the bytes actually are.
    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;

    const store = getStore(STORE_NAME);
    // Convert Node Buffer back to ArrayBuffer view for Netlify Blobs typing.
    const jpegArrayBuffer = jpegBuffer.buffer.slice(
      jpegBuffer.byteOffset,
      jpegBuffer.byteOffset + jpegBuffer.byteLength
    ) as ArrayBuffer;
    await store.set(id, jpegArrayBuffer, {
      metadata: {
        originalName: file.name,
        originalContentType: file.type || 'unknown',
        originalSize: file.size,
        contentType: 'image/jpeg',
        size: jpegBuffer.length,
        uploadedAt: new Date().toISOString(),
        normalised: 'jpeg-v1',
      },
    });

    return NextResponse.json({
      ok: true,
      id,
      url: `/api/images/${id}`,
      contentType: 'image/jpeg',
      size: jpegBuffer.length,
      originalSize: file.size,
    });
  } catch (err: any) {
    console.error('image upload error:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Upload failed' }, { status: 500 });
  }
}
