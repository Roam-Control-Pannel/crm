import type { T } from './harness';
import { createFakeStore } from './fake-store';
import { mutateBlob, isBlobConflictError } from '@/lib/blob-cas';
import { isStoreReadError } from '@/lib/store-read';

const KEY = 'andy:social_posts';
const post = (id: string, status = 'scheduled', extra: Record<string, unknown> = {}) =>
  ({ id, status, ...extra });

/** The write path as it was before BLOB-CAS-V1, for contrast. */
async function legacyWrite(store: any, key: string, mutate: (cur: any[]) => any[]) {
  const snapshot = (await store.getWithMetadata(key, { type: 'json' }))?.data ?? [];
  await store.setJSON(key, mutate(snapshot));
}

export async function run(t: T) {
  t.group('the double-publish race, through both write paths');
  {
    // publish-due closes post A out while another writer is mid-mutation.
    const closeOutA = (s: any) => () =>
      s.seed(KEY, [post('A', 'published', { publishResults: [{ ok: true }] }), post('B')]);

    const legacy = createFakeStore();
    legacy.seed(KEY, [post('A'), post('B')]);
    legacy.onNextRead(closeOutA(legacy));
    await legacyWrite(legacy, KEY, cur =>
      cur.map(p => (p.id === 'B' ? { ...p, scheduledAt: 'moved' } : p))
    );
    const legacyA = legacy.peek(KEY).find((p: any) => p.id === 'A');
    t.is('old path reverts A to scheduled — the live bug', legacyA.status, 'scheduled');
    t.is('old path wipes its publishResults', legacyA.publishResults, undefined);

    const cas = createFakeStore();
    cas.seed(KEY, [post('A'), post('B')]);
    cas.onNextRead(closeOutA(cas));
    await mutateBlob<any[]>(cas, KEY, cur =>
      (cur || []).map(p => (p.id === 'B' ? { ...p, scheduledAt: 'moved' } : p))
    );
    const casRows = cas.peek(KEY);
    const casA = casRows.find((p: any) => p.id === 'A');
    t.is('CAS keeps A published', casA.status, 'published');
    t.is('CAS keeps its publishResults', casA.publishResults, [{ ok: true }]);
    t.is('CAS still applies our own change', casRows.find((p: any) => p.id === 'B').scheduledAt, 'moved');
  }

  t.group('apply() re-runs against the newer value');
  {
    const s = createFakeStore();
    s.seed(KEY, [post('A')]);
    let calls = 0;
    s.onNextRead(() => s.seed(KEY, [post('A'), post('C')]));
    const result = await mutateBlob<any[]>(s, KEY, cur => {
      calls++;
      return [...(cur || []), post(`NEW${calls}`)];
    });
    t.is('apply ran twice', calls, 2);
    t.is('the concurrent insert survived', result.map((p: any) => p.id), ['A', 'C', 'NEW2']);
    t.is('and it re-read before re-applying', s.reads, 2);
  }

  t.group('a mutation that can never win gives up rather than clobbering');
  {
    const s = createFakeStore();
    s.seed(KEY, [post('A')]);
    let tries = 0;
    await t.throws(
      'throws BlobConflictError',
      () =>
        mutateBlob<any[]>(
          s,
          KEY,
          cur => {
            tries++;
            s.seed(KEY, [post('A'), post(`X${tries}`)]); // a competitor lands every time
            return [...(cur || []), post('MINE')];
          },
          { attempts: 3 }
        ),
      isBlobConflictError
    );
    t.is('tried exactly the configured number of times', tries, 3);
    t.ok('nothing of ours was written', !s.peek(KEY).some((p: any) => p.id === 'MINE'));
  }

  t.group('create-only semantics on an absent key');
  {
    const s = createFakeStore();
    let sawNull = false;
    const created = await mutateBlob<any[]>(s, KEY, cur => {
      sawNull = cur === null;
      return [post('FIRST')];
    });
    t.ok('apply sees null, not an invented []', sawNull);
    t.is('created', created.map((p: any) => p.id), ['FIRST']);

    const race = createFakeStore();
    race.onNextRead(() => race.seed(KEY, [post('OTHER')]));
    const both = await mutateBlob<any[]>(race, KEY, cur => [...(cur || []), post('MINE')]);
    t.is("a competing first writer's row is not lost", both.map((p: any) => p.id), ['OTHER', 'MINE']);
  }

  t.group('fail-closed reads');
  {
    const s = createFakeStore();
    s.seed(KEY, [post('A')]);
    s.breakReads(true);
    await t.throws('a broken read throws StoreReadError', () => mutateBlob(s, KEY, () => []), isStoreReadError);
    s.breakReads(false);
    t.is('and wrote nothing', s.peek(KEY).map((p: any) => p.id), ['A']);
  }
}
