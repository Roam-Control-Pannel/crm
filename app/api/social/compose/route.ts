import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
import { isValidBlobId } from '@/lib/uploads';
import { composeGraphic } from '@/lib/compose-graphic';
import {
  GRAPHIC_FORMATS,
  type GraphicFormat,
  type ScrimStyle,
} from '@/lib/graphic-formats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STORE_NAME = 'roam-uploads';

/**
 * GRAPHIC-COMPOSE-V1
 *
 * POST /api/social/compose
 *   body: { blobId, format, headline?, kicker?, logo?, scrim? }
 *   -> { ok: true, id, url, width, height, headlineDrawn }
 *
 * Builds a branded, platform-shaped graphic from a photo already in
 * roam-uploads and stores the result as a new blob. The source is left
 * untouched — a graphic is a derivative, and the Brain photo has to stay
 * usable for the next post.
 *
 * Auth: not in middleware's PUBLIC_API_ROUTES, so a session or the
 * x-internal-call secret is required.
 *
 * SOURCE IS A BLOB ID, NEVER A URL. The composer fetches nothing: it reads
 * the named key out of our own store. Accepting a URL here would hand an
 * authenticated caller a server-side fetch primitive pointed wherever they
 * liked, and the id is shape-checked with the same isValidBlobId that guards
 * the public reader — the guard that stopped `..%2Fsite%3Aroam-tokens%2F...`
 * walking out of roam-uploads into the OAuth token store.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const blobId: string = typeof body?.blobId === 'string' ? body.blobId : '';
  if (!isValidBlobId(blobId)) {
    return NextResponse.json({ ok: false, error: 'Unknown image' }, { status: 400 });
  }

  const format: GraphicFormat = GRAPHIC_FORMATS[body?.format as GraphicFormat]
    ? (body.format as GraphicFormat)
    : 'square';
  const scrim: ScrimStyle =
    body?.scrim === 'full' || body?.scrim === 'none' ? body.scrim : 'bottom';

  // Headlines are drawn, not stored, so the only real limit is what fits.
  // Cutting here keeps a pasted caption from becoming an unreadable wall and
  // keeps the fit loop bounded.
  const headline: string = typeof body?.headline === 'string' ? body.headline.slice(0, 160) : '';
  const kicker: string = typeof body?.kicker === 'string' ? body.kicker.slice(0, 60) : '';

  try {
    const store = getStore(STORE_NAME);
    const source = await store.get(blobId, { type: 'arrayBuffer' });
    if (!source) {
      return NextResponse.json({ ok: false, error: 'Image not found' }, { status: 404 });
    }

    const result = await composeGraphic(Buffer.from(source), {
      format,
      headline,
      kicker,
      logo: body?.logo !== false,
      scrim,
    });

    // Same key convention as /api/images/upload, so /api/images/[id] serves
    // it and isValidBlobId accepts it. A graphic is a JPEG like any other.
    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;
    const arrayBuffer = result.buffer.buffer.slice(
      result.buffer.byteOffset,
      result.buffer.byteOffset + result.buffer.byteLength
    ) as ArrayBuffer;
    await store.set(id, arrayBuffer, {
      metadata: {
        contentType: 'image/jpeg',
        size: result.buffer.length,
        uploadedAt: new Date().toISOString(),
        normalised: 'jpeg-v1',
        // Provenance, so a graphic can be traced back to the photo it came
        // from — and so a future cleanup can tell derivatives from originals.
        composedFrom: blobId,
        composedFormat: format,
      },
    });

    return NextResponse.json({
      ok: true,
      id,
      url: `/api/images/${id}`,
      width: result.width,
      height: result.height,
      headlineDrawn: result.headlineDrawn,
    });
  } catch (err: any) {
    // assertBrandFont throws here when the font was not deployed. That is a
    // real failure and must surface — rendering the headline in whatever face
    // Pango falls back to would ship an off-brand graphic that looks fine
    // enough for nobody to report it.
    console.error('[social/compose] failed:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Could not build the graphic' },
      { status: 500 }
    );
  }
}
