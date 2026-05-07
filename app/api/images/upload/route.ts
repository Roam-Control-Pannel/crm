import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

export const dynamic = 'force-dynamic';

const STORE_NAME = 'roam-uploads';

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

    // Generate a stable ID
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
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
