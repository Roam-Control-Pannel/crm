import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

export const dynamic = 'force-dynamic';

const STORE = 'roam-brain';
const KEY = 'folders';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

async function getFolders(): Promise<Folder[]> {
  try {
    const store = getStore(STORE);
    const data = await store.get(KEY, { type: 'json' });
    return (data as Folder[]) || [];
  } catch { return []; }
}

async function setFolders(folders: Folder[]) {
  const store = getStore(STORE);
  await store.set(KEY, JSON.stringify(folders));
}

export async function GET() {
  try {
    const folders = await getFolders();
    return NextResponse.json({ ok: true, folders });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, parentId } = await req.json();
    if (!name || !name.trim()) {
      return NextResponse.json({ ok: false, error: 'Name required' }, { status: 400 });
    }
    const folders = await getFolders();
    const folder: Folder = {
      id: 'fld_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: name.trim(),
      parentId: parentId || null,
      createdAt: new Date().toISOString(),
    };
    folders.push(folder);
    await setFolders(folders);
    return NextResponse.json({ ok: true, folder });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
