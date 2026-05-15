/**
 * Brain — Roam-io's knowledge base.
 * Client helpers for /api/brain/* endpoints.
 */

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export interface BrainItem {
  id: string;
  blobId: string;
  folderId: string | null;
  tags: string[];
  description: string;
  mime: string;
  size: number;
  uploadedAt: string;
}

// Folder tree node — for rendering nested UI
export interface FolderNode {
  folder: Folder;
  children: FolderNode[];
  itemCount: number;
}

// =================================================================
// Folder operations
// =================================================================
export async function fetchFolders(): Promise<Folder[]> {
  try {
    const res = await fetch('/api/brain/folders');
    const data = await res.json();
    return data.folders || [];
  } catch { return []; }
}

export async function createFolder(name: string, parentId: string | null = null): Promise<Folder | null> {
  try {
    const res = await fetch('/api/brain/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId }),
    });
    const data = await res.json();
    return data.ok ? data.folder : null;
  } catch { return null; }
}

export async function renameFolder(id: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/brain/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    return !!data.ok;
  } catch { return false; }
}

export async function moveFolder(id: string, parentId: string | null): Promise<boolean> {
  try {
    const res = await fetch(`/api/brain/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId }),
    });
    const data = await res.json();
    return !!data.ok;
  } catch { return false; }
}

export async function deleteFolder(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/brain/folders/${id}`, { method: 'DELETE' });
    const data = await res.json();
    return !!data.ok;
  } catch { return false; }
}

// =================================================================
// Item operations
// =================================================================
export async function fetchItems(folderId?: string | null): Promise<BrainItem[]> {
  try {
    let url = '/api/brain/items';
    if (folderId === null) url += '?folderId=root';
    else if (folderId) url += '?folderId=' + encodeURIComponent(folderId);
    const res = await fetch(url);
    const data = await res.json();
    return data.items || [];
  } catch { return []; }
}

export async function uploadItem(file: File, folderId: string | null = null): Promise<BrainItem | null> {
  if (file.size > 8 * 1024 * 1024) throw new Error('File too large (max 8MB)');
  const fd = new FormData();
  fd.append('file', file);
  if (folderId) fd.append('folderId', folderId);
  const res = await fetch('/api/brain/items', { method: 'POST', body: fd });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Upload failed');
  return data.item;
}

/**
 * Upload an image attached to a Roam-io chat message. Lands in the
 * 'Roam-io attachments' folder (auto-created under root). Returns the
 * full BrainItem so callers can grab blobId + auto-generated tags.
 */
export async function uploadChatImage(file: File): Promise<BrainItem | null> {
  if (!file.type.startsWith('image/')) throw new Error('Not an image');
  if (file.size > 8 * 1024 * 1024) throw new Error('Image too large (max 8MB)');
  const fd = new FormData();
  fd.append('file', file);
  fd.append('folderName', 'Roam-io attachments');
  fd.append('extraTag', 'roam-io-chat-attachment');
  const res = await fetch('/api/brain/items', { method: 'POST', body: fd });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Upload failed');
  return data.item;
}

/**
 * Save a chunk of text (chat message, note, extracted memory) to Brain.
 * Lands in "Roam-io saves" folder by default. Source tag lets us filter
 * later — e.g. 'roam-io-chat', 'roam-io-memory', 'manual-note'.
 */
export interface SaveTextOptions {
  content: string;
  tags?: string[];
  description?: string;
  source?: string;
  folderId?: string | null;
  autoFolder?: boolean;
  contextBefore?: string;
  contextAfter?: string;
}

export async function saveTextToBrain(opts: SaveTextOptions): Promise<BrainItem | null> {
  const res = await fetch('/api/brain/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Save failed');
  return data.item;
}

export async function updateItem(id: string, patch: Partial<Pick<BrainItem, 'tags' | 'description' | 'folderId'>>): Promise<boolean> {
  try {
    const res = await fetch(`/api/brain/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    return !!data.ok;
  } catch { return false; }
}

export async function deleteItem(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/brain/items/${id}`, { method: 'DELETE' });
    const data = await res.json();
    return !!data.ok;
  } catch { return false; }
}

// =================================================================
// Tree utilities
// =================================================================
export function buildFolderTree(folders: Folder[], items: BrainItem[]): FolderNode[] {
  const itemCountByFolder: Record<string, number> = {};
  items.forEach(i => {
    if (i.folderId) itemCountByFolder[i.folderId] = (itemCountByFolder[i.folderId] || 0) + 1;
  });

  const byParent: Record<string, Folder[]> = {};
  folders.forEach(f => {
    const key = f.parentId || '__root__';
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(f);
  });

  function build(parentId: string | null): FolderNode[] {
    const list = byParent[parentId || '__root__'] || [];
    return list.map(folder => ({
      folder,
      itemCount: itemCountByFolder[folder.id] || 0,
      children: build(folder.id),
    })).sort((a, b) => a.folder.name.localeCompare(b.folder.name));
  }

  return build(null);
}

export function getFolderPath(folders: Folder[], folderId: string | null): Folder[] {
  if (!folderId) return [];
  const path: Folder[] = [];
  let cursor: string | null = folderId;
  const safety = 50;
  let i = 0;
  while (cursor && i++ < safety) {
    const f = folders.find(x => x.id === cursor);
    if (!f) break;
    path.unshift(f);
    cursor = f.parentId;
  }
  return path;
}

// =================================================================
// Search
// =================================================================
export function searchItems(items: BrainItem[], query: string): BrainItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(i =>
    i.description.toLowerCase().includes(q) ||
    i.tags.some(t => t.toLowerCase().includes(q))
  );
}

export function imageUrl(item: BrainItem): string {
  return `/api/images/${item.blobId}`;
}
