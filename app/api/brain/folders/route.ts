import { NextRequest, NextResponse } from 'next/server';
// BRAIN-STORE-V1: shared, fail-closed index accessors. Creating a folder is
// read-append-write, so the old swallow-as-[] behaviour meant a failed read
// replaced every existing folder with the one being created.
import { getFolders, setFolders, type Folder } from '@/lib/brain-store';
import { readErrorResponse } from '@/lib/store-read';

export type { Folder };

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const folders = await getFolders();
    return NextResponse.json({ ok: true, folders });
  } catch (err: any) {
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
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
    const { body, status } = readErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
