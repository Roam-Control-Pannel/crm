import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

export const dynamic = 'force-dynamic';

const STORE_NAME = 'roam-uploads';

interface RouteParams {
  params: { id: string };
}

/**
 * Stream an uploaded image back by ID.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const store = getStore(STORE_NAME);
    const result = await store.getWithMetadata(params.id, { type: 'arrayBuffer' });

    if (!result) {
      return new NextResponse('Not found', { status: 404 });
    }

    const contentType = (result.metadata?.contentType as string) || 'image/jpeg';
    return new NextResponse(result.data as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err: any) {
    console.error('image fetch error:', err);
    return new NextResponse('Error', { status: 500 });
  }
}
