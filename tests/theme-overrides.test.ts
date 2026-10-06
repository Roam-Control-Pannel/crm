import type { T } from './harness';
import { mergeThemeOverrides, EMPTY_OVERRIDES } from '@/lib/social-settings-types';
import { mergeThemes } from '@/lib/social-settings';
import type { Theme } from '@/lib/social-themes';

const custom = (id: string, title = id): Theme =>
  ({ id, title, category: 'seasonal', enabled: true, prompt: '' } as unknown as Theme);

export async function run(t: T) {
  t.group('the custom-theme wipe: a single toggle used to delete every addition');
  {
    const stored = {
      enabled: {},
      edits: {},
      additions: [custom('T1'), custom('T2')],
      deletions: [],
    };
    // What the UI sends when one seed theme is toggled off.
    const toggle = { enabled: { 'seed-a': false }, edits: {}, additions: [], deletions: [] };

    t.is('old behaviour: incomingOverrides replaced the stored set',
      (toggle as any).additions, []);

    const merged = mergeThemeOverrides(stored, toggle);
    t.is('merged keeps both custom themes', merged.additions.map(a => a.id), ['T1', 'T2']);
    t.is('and applies the toggle', merged.enabled, { 'seed-a': false });
  }

  t.group('merge semantics per field');
  {
    const base = {
      enabled: { a: false },
      edits: { a: { title: 'Edited A' } as any },
      additions: [custom('T1', 'One')],
      deletions: ['seed-x'],
    };
    const incoming = {
      enabled: { b: true },
      edits: { b: { title: 'Edited B' } as any },
      additions: [custom('T1', 'One renamed'), custom('T2')],
      deletions: ['seed-y'],
    };
    const m = mergeThemeOverrides(base, incoming);
    t.is('enabled merges by key', m.enabled, { a: false, b: true });
    t.is('edits merge by key', Object.keys(m.edits).sort(), ['a', 'b']);
    t.is('deletions union', m.deletions.sort(), ['seed-x', 'seed-y']);
    t.is('additions upsert by id, not duplicate',
      m.additions.map(a => `${a.id}:${a.title}`), ['T1:One renamed', 'T2:T2']);
  }

  t.group('deleting a custom theme actually deletes it');
  {
    const stored = { enabled: {}, edits: {}, additions: [custom('T1'), custom('T2')], deletions: [] };
    // deleteUserTheme repurposes `deletions` for custom ids.
    const m = mergeThemeOverrides(stored, { enabled: {}, edits: {}, additions: [], deletions: ['T1'] });
    t.is('the addition is dropped from the override set', m.additions.map(a => a.id), ['T2']);
    t.ok('and mergeThemes does not render it',
      !mergeThemes(m).some(x => x.id === 'T1'));
    t.ok('while the other custom theme survives',
      mergeThemes(m).some(x => x.id === 'T2'));
  }

  t.group('a deleted custom theme does not come back on the next save');
  {
    let o = mergeThemeOverrides(
      { enabled: {}, edits: {}, additions: [custom('T1')], deletions: [] },
      { enabled: {}, edits: {}, additions: [], deletions: ['T1'] }
    );
    o = mergeThemeOverrides(o, { enabled: { 'seed-a': false }, edits: {}, additions: [], deletions: [] });
    t.is('still gone after an unrelated toggle', o.additions.map(a => a.id), []);
  }

  t.group('degenerate inputs');
  {
    t.is('no stored overrides', mergeThemeOverrides(undefined, { enabled: { a: true } }).enabled, { a: true });
    t.is('no incoming overrides', mergeThemeOverrides(EMPTY_OVERRIDES, undefined), EMPTY_OVERRIDES);
    t.is('an all-empty incoming is a no-op under merge',
      mergeThemeOverrides(
        { enabled: { a: true }, edits: {}, additions: [custom('T1')], deletions: ['x'] },
        { enabled: {}, edits: {}, additions: [], deletions: [] }
      ).additions.map(a => a.id),
      ['T1']);
  }
}
