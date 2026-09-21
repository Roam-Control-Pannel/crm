import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
import { isValidBlobId, SERVABLE_CONTENT_TYPES } from '@/lib/uploads';

export const dynamic = 'force-dynamic';

const STORE_NAME = 'roam-uploads';

interface RouteParams {
  params: { id: string };
}

/**
 * Stream an uploaded image back by ID.
 *
 * IMAGE-READ-HARDENING-V1
 *
 * This route is deliberately public (middleware.ts explains why: Instagram
 * can only ingest an image from an unauthenticated URL). That makes it the
 * one place where an unvalidated blob key is reachable by anyone, so it
 * carries two guards the rest of the app doesn't need:
 *
 *  1. The id must match a key shape this app actually generates. The
 *     Netlify Blobs client interpolates the key straight into the request
 *     path and runs validateKey() on writes only, so `getWithMetadata('../
 *     site:roam-tokens/andy')` is normalised by new URL() into a read of
 *     the credential store. Percent-encoding gets the traversal past
 *     middleware (which sees the raw pathname) because Next decodes the
 *     dynamic segment afterwards. Checking the shape here closes that
 *     regardless of what middleware saw.
 *
 *  2. The outgoing Content-Type is clamped to a fixed allowlist rather than
 *     echoed from blob metadata. Historic items were stored with a
 *     caller-supplied type, so without this a file uploaded as text/html
 *     would be served as HTML on our own origin — with a year-long immutable
 *     cache and no session required to fetch it.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  // Guard 1: shape-check before the key ever reaches the blob client.
  if (!isValidBlobId(params.id)) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const store = getStore(STORE_NAME);
    const result = await store.getWithMetadata(params.id, { type: 'arrayBuffer' });

    if (!result) {
      return new NextResponse('Not found', { status: 404 });
    }

    // Guard 2: only ever emit a type we know is inert in a browser. Anything
    // else (including a legacy text/html item) downloads instead of renders.
    const stored = (result.metadata?.contentType as string) || '';
    const servable = SERVABLE_CONTENT_TYPES.has(stored);
    const contentType = servable ? stored : 'application/octet-stream';

    // A sandboxed, subresource-free CSP is belt-and-braces on top of the
    // type allowlist and the global nosniff header. PDFs are exempted from
    // `sandbox` only because it interferes with the browser's built-in
    // viewer; a PDF served under an exact application/pdf type with nosniff
    // has no path to the DOM of our origin anyway.
    const csp =
      contentType === 'application/pdf'
        ? "default-src 'none'"
        : "default-src 'none'; sandbox";

    return new NextResponse(result.data as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': servable
          ? `inline; filename="${params.id}"`
          : `attachment; filename="${params.id}"`,
        'Content-Security-Policy': csp,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err: any) {
    console.error('image fetch error:', err);
    return new NextResponse('Error', { status: 500 });
  }
}
