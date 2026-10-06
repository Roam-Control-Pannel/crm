import { getStore } from '@netlify/blobs';
import { readStored } from './store-read';
import { mutateBlob } from './blob-cas';

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

/**
 * FAIL-CLOSED-READS-V1: throws on a read failure. setListHidden() below is a
 * read-modify-write of the whole set, so an empty result meant hiding one
 * list un-hid every other one.
 */
export async function getHiddenListIds(): Promise<number[]> {
  const data = await readStored<HiddenListsBlob>('the hidden Brevo list set', () =>
    store().get(KEY, { type: 'json' })
  );
  return Array.isArray(data?.hiddenListIds) ? data!.hiddenListIds : [];
}

function clean(ids: number[]): number[] {
  return Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0))).sort((a, b) => a - b);
}

/**
 * BLOB-CAS-V1: toggling one list is a read-modify-write of the whole set, so
 * two toggles in flight at once used to end with only the later one applied.
 */
export async function setListHidden(listId: number, hidden: boolean): Promise<number[]> {
  const blob = await mutateBlob<HiddenListsBlob>(
    store(),
    KEY,
    current => {
      const set = new Set(Array.isArray(current?.hiddenListIds) ? current!.hiddenListIds : []);
      if (hidden) set.add(listId);
      else set.delete(listId);
      return { hiddenListIds: clean(Array.from(set)) };
    },
    { what: 'the hidden Brevo list set' }
  );
  return blob.hiddenListIds;
}

/**
 * Replace the full set in one write — used by the Settings page's bulk unhide.
 *
 * This deliberately replaces rather than merges: "unhide everything" is an
 * instruction about the whole set, not about the rows the caller happened to
 * see. It still goes through the conditional write so it cannot silently land
 * on top of a concurrent toggle.
 *
 * The write used to be wrapped in a try/catch that logged and returned `next`
 * anyway, so a failed write answered 200 with the new array: the operator saw
 * every town unhidden, and the next dashboard load read the unchanged blob
 * and hid them all again. A write that did not happen is not a success, so
 * this now throws and the route reports it.
 */
export async function setHiddenListIds(ids: number[]): Promise<number[]> {
  const next = clean(ids);
  const blob = await mutateBlob<HiddenListsBlob>(
    store(),
    KEY,
    () => ({ hiddenListIds: next }),
    { what: 'the hidden Brevo list set' }
  );
  return blob.hiddenListIds;
}
