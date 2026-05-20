import { getStore } from '@netlify/blobs';

/**
 * Persisted set of Brevo list IDs the user has chosen to hide from the
 * Active Towns card on the Growth Dashboard. Lists we're not actively
 * working get tucked away here so the dashboard stays focused.
 *
 * Storage: Netlify Blobs, same store as other workspace settings.
 */

const STORE_NAME = 'roam-system';
const KEY = 'hidden-lists';

interface HiddenListsBlob {
  hiddenListIds: number[];
}

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

export async function getHiddenListIds(): Promise<number[]> {
  try {
    const data = (await store().get(KEY, { type: 'json' })) as HiddenListsBlob | null;
    return Array.isArray(data?.hiddenListIds) ? data!.hiddenListIds : [];
  } catch (err) {
    console.error('[hidden-lists] read failed:', err);
    return [];
  }
}

export async function setListHidden(listId: number, hidden: boolean): Promise<number[]> {
  const current = await getHiddenListIds();
  const set = new Set(current);
  if (hidden) set.add(listId);
  else set.delete(listId);
  const next = Array.from(set).sort((a, b) => a - b);
  try {
    await store().setJSON(KEY, { hiddenListIds: next } as any);
  } catch (err) {
    console.error('[hidden-lists] write failed:', err);
  }
  return next;
}

/** Replace the full set in one write — used by the Settings page's bulk unhide. */
export async function setHiddenListIds(ids: number[]): Promise<number[]> {
  const next = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0))).sort((a, b) => a - b);
  try {
    await store().setJSON(KEY, { hiddenListIds: next } as any);
  } catch (err) {
    console.error('[hidden-lists] bulk write failed:', err);
  }
  return next;
}
