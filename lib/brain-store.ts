/**
 * BRAIN-STORE-V1
 *
 * The Brain index (items + folders) lives in one blob store, but the
 * accessors for it were copy-pasted into six route files:
 *
 *   app/api/brain/items/route.ts            getItems / setItems / getFolders / setFolders
 *   app/api/brain/items/[id]/route.ts       getItems / setItems
 *   app/api/brain/items/[id]/content/route.ts  getItems
 *   app/api/brain/folders/route.ts          getFolders / setFolders
 *   app/api/brain/folders/[id]/route.ts     getFolders / setFolders / getItems / setItems
 *   app/api/brain/search/route.ts           getItems / getFolders
 *
 * Every copy swallowed a read failure as `[]`. Combined with the
 * read-append-write shape of the writers, a single Blobs hiccup during an
 * upload replaced the whole index with just the item being added — the
 * Brain wiped by one unlucky request.
 *
 * One definition now, and it fails closed: see lib/store-read.ts.
 */

import { getStore } from '@netlify/blobs';
import { readStored } from './store-read';

const STORE_NAME = 'roam-brain';
const ITEMS_KEY = 'items';
const FOLDERS_KEY = 'folders';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export interface Item {
  id: string;
  blobId: string;          // key in roam-uploads store
  folderId: string | null;
  tags: string[];
  description: string;
  mime: string;
  size: number;
  uploadedAt: string;
  /** Source URL for scraped web items. Lets the Brain UI surface the
   *  original link and lets users re-scrape if the page changed. */
  sourceUrl?: string;
}

function brainStore() {
  return getStore(STORE_NAME);
}

/**
 * The Brain's item index. Returns [] only when nothing has ever been
 * stored; THROWS StoreReadError if the read itself failed.
 *
 * Callers that go on to setItems() must let that throw propagate.
 */
export async function getItems(): Promise<Item[]> {
  const data = await readStored<Item[]>('the Brain item index', () =>
    brainStore().get(ITEMS_KEY, { type: 'json' })
  );
  return data ?? [];
}

export async function setItems(items: Item[]): Promise<void> {
  await brainStore().set(ITEMS_KEY, JSON.stringify(items));
}

/**
 * The Brain's folder list. Same contract as getItems().
 */
export async function getFolders(): Promise<Folder[]> {
  const data = await readStored<Folder[]>('the Brain folder list', () =>
    brainStore().get(FOLDERS_KEY, { type: 'json' })
  );
  return data ?? [];
}

export async function setFolders(folders: Folder[]): Promise<void> {
  await brainStore().set(FOLDERS_KEY, JSON.stringify(folders));
}
