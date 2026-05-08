import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_USER_ID,
  isCollectionKey,
  getCollection,
  saveCollection,
  deleteCollection,
} from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /api/store/[key] — generic read/write for any user collection.
 *
 *   GET    /api/store/social_posts       -> returns array or null
 *   POST   /api/store/social_posts       -> body { data: [...] } replaces collection
 *   DELETE /api/store/social_posts       -> wipes collection
 *
 * Single-user mode: always uses DEFAULT_USER_ID. When multi-user is added,
 * resolve the user id from the session here.
 */

function resolveKey(rawKey: string) {
  if (!isCollectionKey(rawKey)) {
    return null;
  }
  return rawKey;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { key: string } }
) {
  const key = resolveKey(params.key);
  if (!key) {
    return NextResponse.json({ error: 'Unknown collection' }, { status: 400 });
  }
  try {
    const data = await getCollection(DEFAULT_USER_ID, key);
    return NextResponse.json({ data });
  } catch (err: any) {
    console.error(`store GET ${key} failed:`, err);
    return NextResponse.json(
      { error: err?.message || 'Failed to read store' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { key: string } }
) {
  const key = resolveKey(params.key);
  if (!key) {
    return NextResponse.json({ error: 'Unknown collection' }, { status: 400 });
  }
  try {
    const body = await req.json();
    if (!('data' in body)) {
      return NextResponse.json(
        { error: 'Body must include `data` field' },
        { status: 400 }
      );
    }
    await saveCollection(DEFAULT_USER_ID, key, body.data);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(`store POST ${key} failed:`, err);
    return NextResponse.json(
      { error: err?.message || 'Failed to write store' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { key: string } }
) {
  const key = resolveKey(params.key);
  if (!key) {
    return NextResponse.json({ error: 'Unknown collection' }, { status: 400 });
  }
  try {
    await deleteCollection(DEFAULT_USER_ID, key);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(`store DELETE ${key} failed:`, err);
    return NextResponse.json(
      { error: err?.message || 'Failed to delete store' },
      { status: 500 }
    );
  }
}
