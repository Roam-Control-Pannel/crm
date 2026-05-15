// SOCIAL-SETTINGS-V1
'use client';

/**
 * /social/settings — posting times + themes management.
 *
 * Consumes the API shipped in patch 3b-i:
 *   GET    /api/social/settings              → { settings: { postingTimes, themes } }
 *   PUT    /api/social/settings { partial }  → { settings }
 *   DELETE /api/social/settings              → wipes blob, next GET returns defaults
 *
 * Writes are debounced-by-action (each toggle / save fires a PUT with only
 * the changed slice). Theme edits go through an explicit Save in the modal.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Trash2, Edit3, Check, X, RotateCcw, Save, AlertTriangle, Settings,
} from 'lucide-react';

import {
  THEME_CATEGORIES,
  BRIEF_IDS,
  type Theme,
  type ThemeCategory,
} from '@/lib/social-themes';

import {
  type PostingTimes,
  type ThemeOverrides,
  type EffectiveSocialSettings,
  type PostingTimeSlot,
} from '@/lib/social-settings-types';
import { fetchBriefs, type Brief } from '@/lib/briefs';

// ---------- style tokens (kept consistent with app/social/page.tsx) ----------

const inp = {
  width: '100%', padding: '8px 12px', border: '1.5px solid var(--ink-200)',
  borderRadius: 'var(--r-sm)', fontSize: 13, fontFamily: 'inherit', background: 'var(--white)',
} as const;

const btnG = {
  padding: '7px 14px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--ink-200)',
  background: 'var(--white)', fontSize: 12, fontWeight: 500, color: 'var(--ink-700)',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
} as const;

const btnP = {
  padding: '7px 14px', borderRadius: 'var(--r-sm)', border: 'none',
  background: 'var(--maroon-700)', color: 'var(--white)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
} as const;

const btnDanger = {
  ...btnG,
  color: 'var(--maroon-700)',
  borderColor: 'var(--maroon-700)',
} as const;

const card = {
  background: 'var(--white)', borderRadius: 'var(--r-lg)', padding: 20,
  marginBottom: 16, boxShadow: 'var(--shadow-sm)',
} as const;

const sectionTitle = {
  fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700,
  color: 'var(--ink-900)', marginBottom: 4,
} as const;

const sectionSub = {
  fontSize: 12, color: 'var(--ink-500)', marginBottom: 16,
} as const;

// ---------- brief id → display label (small enough to inline) ----------

const BRIEF_LABELS: Record<string, string> = {
  [BRIEF_IDS.ROAM_LOCAL]: 'Roam Local',
  [BRIEF_IDS.ROAM_NI]: 'Roam NI',
  [BRIEF_IDS.ROAM_BUSINESS]: 'Roam for Business',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PLATFORMS: Array<{ key: 'linkedin' | 'facebook' | 'instagram'; label: string }> = [
  { key: 'linkedin',  label: 'LinkedIn' },
  { key: 'facebook',  label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
];

// HH:MM helper — normalises user input, returns null if invalid.
function normaliseTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

// Group slots by time, so the grid shows one row per distinct time.
function distinctTimes(slots: PostingTimeSlot[]): string[] {
  const set = new Set<string>();
  for (const s of slots) set.add(s.time);
  return Array.from(set).sort();
}

function hasSlot(slots: PostingTimeSlot[], day: number, time: string): boolean {
  return slots.some(s => s.day === day && s.time === time);
}

// ---------- page ----------

function BriefWeightsPanel() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Load briefs + current weights from the settings GET
      const [briefList, settingsRes] = await Promise.all([
        fetchBriefs(),
        fetch('/api/social/settings').then(r => r.json()).catch(() => null),
      ]);
      if (cancelled) return;
      setBriefs(briefList);
      const w = settingsRes?.settings?.briefWeights || {};
      setWeights(w);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  async function persist(next: Record<string, number>) {
    setSaving(true);
    try {
      await fetch('/api/social/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefWeights: next }),
      });
    } finally {
      setSaving(false);
    }
  }

  function updateWeight(briefId: string, raw: string) {
    const n = parseInt(raw, 10);
    const v = Number.isFinite(n) && n >= 0 ? Math.min(n, 99) : 1;
    const next = { ...weights, [briefId]: v };
    setWeights(next);
    persist(next);
  }

  function resetToEqual() {
    const next: Record<string, number> = {};
    briefs.forEach(b => { next[b.id] = 1; });
    setWeights(next);
    persist(next);
  }

  // Compute denominator for the % readout (defaults to 1 for missing briefs).
  const total = briefs.reduce((sum, b) => sum + (weights[b.id] || 1), 0);

  if (!loaded) return null;

  return (
    <div id="brief-weights" style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', padding: 18, marginBottom: 14, scrollMarginTop: 80 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-900)' }}>Brief Weights</div>
          <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 4, lineHeight: 1.5 }}>
            When an account has multiple briefs assigned, these weights decide the mix. Higher number = more frequent.
            <br />Default is 1:1 (all equal). Example: 6:1 Tourism:Business means 6 in every 7 posts are Tourism.
          </div>
        </div>
        <button
          onClick={resetToEqual}
          disabled={saving}
          style={{ fontSize: 11, padding: '6px 12px', background: 'var(--white)', border: '1.5px solid var(--ink-200)', borderRadius: 'var(--r-md)', cursor: 'pointer', color: 'var(--ink-600)', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
        >
          Reset to equal
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {briefs.map(b => {
          const w = weights[b.id] ?? 1;
          const pct = total > 0 ? Math.round((w / total) * 100) : 0;
          return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--r-sm)', background: b.color + '08', border: `1px solid ${b.color}22` }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{b.name}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-500)' }}>{pct}% of posts on multi-brief accounts</div>
              </div>
              <input
                type="number"
                min={0}
                max={99}
                value={w}
                onChange={e => updateWeight(b.id, e.target.value)}
                disabled={saving}
                style={{ width: 64, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit', border: '1.5px solid var(--ink-200)', borderRadius: 'var(--r-sm)', textAlign: 'center', background: 'var(--white)' }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SocialSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postingTimes, setPostingTimes] = useState<PostingTimes | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);

  // Edit modal state
  const [editing, setEditing] = useState<Theme | null>(null);
  const [editingIsNew, setEditingIsNew] = useState(false);

  // Confirm dialogs
  const [confirmResetTimes, setConfirmResetTimes] = useState(false);
  const [confirmResetThemes, setConfirmResetThemes] = useState(false);
  const [confirmDeleteTheme, setConfirmDeleteTheme] = useState<Theme | null>(null);

  // ---------- data load ----------

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/social/settings', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET failed: ${res.status}`);
      const json = (await res.json()) as { ok: boolean; settings: EffectiveSocialSettings };
      if (!json.ok) throw new Error('GET returned ok:false');
      setPostingTimes(json.settings.postingTimes);
      setThemes(json.settings.themes);
    } catch (e: any) {
      setError(e?.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ---------- save helpers ----------

  async function putPartial(body: { postingTimes?: PostingTimes; themeOverrides?: ThemeOverrides }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/social/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
      const json = (await res.json()) as { ok: boolean; settings: EffectiveSocialSettings };
      if (!json.ok) throw new Error('PUT returned ok:false');
      setPostingTimes(json.settings.postingTimes);
      setThemes(json.settings.themes);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function resetAll() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/social/settings', { method: 'DELETE' });
      if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Reset failed');
    } finally {
      setSaving(false);
    }
  }

  // ---------- posting time mutators ----------

  function toggleSlot(platform: 'linkedin' | 'facebook' | 'instagram', day: number, time: string) {
    if (!postingTimes) return;
    const slots = postingTimes[platform];
    const exists = hasSlot(slots, day, time);
    const next: PostingTimes = {
      ...postingTimes,
      [platform]: exists
        ? slots.filter(s => !(s.day === day && s.time === time))
        : [...slots, { day, time }],
    };
    setPostingTimes(next); // optimistic
    putPartial({ postingTimes: next });
  }

  function addCustomTime(platform: 'linkedin' | 'facebook' | 'instagram', time: string) {
    if (!postingTimes) return;
    const t = normaliseTime(time);
    if (!t) { setError(`Invalid time "${time}" — use HH:MM (24h)`); return; }
    // Default new times apply to all 7 days. User can untoggle the days they don't want.
    const slots = postingTimes[platform];
    const additions: PostingTimeSlot[] = [];
    for (let d = 0; d < 7; d++) {
      if (!hasSlot(slots, d, t)) additions.push({ day: d, time: t });
    }
    if (additions.length === 0) return; // already fully populated for this time
    const next: PostingTimes = { ...postingTimes, [platform]: [...slots, ...additions] };
    setPostingTimes(next);
    putPartial({ postingTimes: next });
  }

  // ---------- theme mutators ----------

  // We rebuild the full ThemeOverrides payload from scratch on each write,
  // diffing the current effective `themes` against SEED_THEMES knowledge
  // (carried in the theme list itself — seed themes have a stable id format).
  //
  // To avoid duplicating seed knowledge here, we fetch and reuse whatever
  // overrides the server already has by sending a *delta* via the existing
  // overrides shape. Easiest path: derive overrides from the current `themes`
  // array by treating any id starting with 'theme-user-' as user-added.
  function deriveOverrides(nextThemes: Theme[], seedThemeIds: Set<string>): ThemeOverrides {
    const overrides: ThemeOverrides = { enabled: {}, edits: {}, additions: [], deletions: [] };

    for (const t of nextThemes) {
      if (seedThemeIds.has(t.id)) {
        // Seed theme — capture enabled state if it's been flipped.
        // We can't tell here if the title/prompt was edited; the modal save
        // calls putOverridesRaw directly for that case.
        overrides.enabled[t.id] = t.enabled;
      } else {
        overrides.additions.push(t);
      }
    }

    // Anything in seedThemeIds that's NOT in nextThemes was deleted.
    for (const sid of seedThemeIds) {
      if (!nextThemes.some(t => t.id === sid)) overrides.deletions.push(sid);
    }
    return overrides;
  }

  // Send overrides directly — used by the edit modal (which knows whether
  // a theme is seed or user-added).
  function putOverridesRaw(themeOverrides: ThemeOverrides) {
    return putPartial({ themeOverrides });
  }

  function toggleThemeEnabled(theme: Theme) {
    const nextThemes = themes.map(t =>
      t.id === theme.id ? { ...t, enabled: !t.enabled } : t
    );
    setThemes(nextThemes); // optimistic
    // Build a minimal override that just flips this one id's enabled flag.
    // Other overrides on the server (edits, additions, deletions) are
    // preserved because we only send `enabled`.
    putOverridesRaw({
      enabled: { [theme.id]: !theme.enabled },
      edits: {},
      additions: [],
      deletions: [],
    }).then(() => {
      // Server will merge with stored overrides — refresh from response (done in putPartial).
    });
  }

  function startNew() {
    setEditing({
      id: `theme-user-${Date.now().toString(36)}`,
      title: '',
      category: 'community' as ThemeCategory,
      prompt: '',
      briefIds: [BRIEF_IDS.ROAM_LOCAL],
      enabled: true,
    });
    setEditingIsNew(true);
  }

  function startEdit(theme: Theme) {
    setEditing({ ...theme });
    setEditingIsNew(false);
  }

  function saveEdit() {
    if (!editing) return;
    if (!editing.title.trim()) { setError('Title is required'); return; }
    if (!editing.prompt.trim()) { setError('Prompt is required'); return; }

    const isSeed = themes.some(t => t.id === editing.id) && !editing.id.startsWith('theme-user-');

    if (editingIsNew) {
      // User-added theme → push to additions.
      putOverridesRaw({
        enabled: {},
        edits: {},
        additions: [editing],
        deletions: [],
      });
    } else if (isSeed) {
      // Seed theme edit → write to edits[id] (shallow merge).
      const { id, enabled, ...rest } = editing;
      putOverridesRaw({
        enabled: { [id]: enabled },
        edits: { [id]: rest },
        additions: [],
        deletions: [],
      });
    } else {
      // Editing an existing user-added theme → re-send to additions (server replaces by id).
      putOverridesRaw({
        enabled: {},
        edits: {},
        additions: [editing],
        deletions: [],
      });
    }

    setEditing(null);
    setEditingIsNew(false);
  }

  function deleteUserTheme(theme: Theme) {
    // Only user-added themes can be deleted (button hidden for seed).
    putOverridesRaw({
      enabled: {},
      edits: {},
      additions: [],
      // Repurpose deletions for user themes too — server keys removal by id.
      deletions: [theme.id],
    });
    setConfirmDeleteTheme(null);
  }

  // ---------- derived ----------

  const themesByCategory = useMemo(() => {
    const map = new Map<ThemeCategory, Theme[]>();
    for (const cat of THEME_CATEGORIES) map.set(cat.id, []);
    for (const t of themes) {
      const list = map.get(t.category as ThemeCategory);
      if (list) list.push(t);
    }
    return map;
  }, [themes]);

  // ---------- render ----------

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: 980, margin: '0 auto' }}>
        <div style={{ fontSize: 13, color: 'var(--ink-500)' }}>Loading settings…</div>
      </div>
    );
  }

  if (!postingTimes) {
    return (
      <div style={{ padding: 32, maxWidth: 980, margin: '0 auto' }}>
        <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <AlertTriangle size={20} color="var(--warn)" />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Could not load settings</div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 12 }}>
              {error || 'Unknown error'}
            </div>
            <button style={btnG} onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 980, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Link href="/social" style={{ ...btnG, textDecoration: 'none', padding: '5px 10px' }}>
              <ArrowLeft size={12} /> Back
            </Link>
            <Settings size={20} color="var(--ink-700)" />
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1 }}>Social settings</h1>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-500)', marginLeft: 78 }}>
            Posting schedule and content themes for auto-generated posts.
          </p>
        </div>
        {saving && <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>Saving…</div>}
      </div>

      {error && (
        <div style={{ ...card, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', borderLeft: '3px solid var(--maroon-700)' }}>
          <AlertTriangle size={16} color="var(--maroon-700)" />
          <div style={{ fontSize: 12, color: 'var(--ink-700)', flex: 1 }}>{error}</div>
          <button style={btnG} onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}

      {/* PANEL 1 — Posting Times */}
      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <h2 style={sectionTitle}>Posting times</h2>
            <p style={sectionSub}>Click a cell to toggle a slot. Auto-generated posts use these windows.</p>
        {/* CRON-AUTOGEN-V1 lookahead control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-700)' }}>
            Auto-fill calendar
          </label>
          <input
            type="number"
            min={1}
            max={60}
            value={(postingTimes as any).lookaheadDays || 14}
            onChange={e => {
              const n = parseInt(e.target.value, 10);
              if (isNaN(n) || n < 1 || n > 60) return;
              setPostingTimes({ ...postingTimes, lookaheadDays: n } as any);
            }}
            style={{ width: 64, padding: '4px 6px', border: '1px solid var(--ink-200)', borderRadius: 4, fontSize: 13 }}
          />
          <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>
            days ahead. Daily cron fills drafts for this window.
          </span>
        </div>

          </div>
          <button style={btnDanger} onClick={() => setConfirmResetTimes(true)}>
            <RotateCcw size={12} /> Reset times
          </button>
        </div>

        {PLATFORMS.map(({ key, label }) => {
          const slots = postingTimes[key];
          const times = distinctTimes(slots);
          return (
            <div key={key} style={{ marginTop: 16, padding: 16, background: 'var(--paper)', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-100)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>{slots.length} slot{slots.length === 1 ? '' : 's'}/week</div>
              </div>

              {times.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-400)', marginBottom: 12 }}>
                  No times configured. Add one below.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '70px repeat(7, 1fr)', gap: 4, marginBottom: 12 }}>
                  <div />
                  {DAY_LABELS.map(d => (
                    <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase' }}>{d}</div>
                  ))}
                  {times.map(time => (
                    <>
                      <div key={time + '-label'} style={{ fontSize: 11, color: 'var(--ink-700)', fontWeight: 600, alignSelf: 'center' }}>{time}</div>
                      {[0, 1, 2, 3, 4, 5, 6].map(day => {
                        const on = hasSlot(slots, day, time);
                        return (
                          <button
                            key={`${time}-${day}`}
                            type="button"
                            onClick={() => toggleSlot(key, day, time)}
                            title={on ? `Click to remove ${DAY_LABELS[day]} ${time}` : `Click to add ${DAY_LABELS[day]} ${time}`}
                            style={{
                              padding: '6px 0',
                              borderRadius: 'var(--r-xs)',
                              border: on ? '1.5px solid var(--maroon-700)' : '1.5px solid var(--ink-200)',
                              background: on ? 'var(--maroon-700)' : 'var(--white)',
                              color: on ? 'var(--white)' : 'var(--ink-300)',
                              cursor: 'pointer',
                              fontSize: 11,
                              fontFamily: 'inherit',
                            }}
                          >
                            {on ? '●' : '–'}
                          </button>
                        );
                      })}
                    </>
                  ))}
                </div>
              )}

              <AddCustomTime onAdd={t => addCustomTime(key, t)} />
            </div>
          );
        })}
      </section>

      {/* MULTI-BRIEF-V1: PANEL 1.5 — Brief Weights */}
      <BriefWeightsPanel />

      {/* PANEL 2 — Themes */}
      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <h2 style={sectionTitle}>Themes</h2>
            <p style={sectionSub}>Content angles the generator picks from. Disable to exclude, edit to refine.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnP} onClick={startNew}><Plus size={12} /> New theme</button>
            <button style={btnDanger} onClick={() => setConfirmResetThemes(true)}>
              <RotateCcw size={12} /> Reset themes
            </button>
          </div>
        </div>

        {THEME_CATEGORIES.map(cat => {
          const list = themesByCategory.get(cat.id) || [];
          if (list.length === 0) return null;
          return (
            <div key={cat.id} style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                {cat.label} <span style={{ color: 'var(--ink-300)', fontWeight: 500 }}>· {list.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {list.map(theme => {
                  const isUserAdded = theme.id.startsWith('theme-user-');
                  return (
                    <div key={theme.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      background: 'var(--paper)', borderRadius: 'var(--r-sm)', border: '1px solid var(--ink-100)',
                      opacity: theme.enabled ? 1 : 0.55,
                    }}>
                      <button
                        type="button"
                        onClick={() => toggleThemeEnabled(theme)}
                        title={theme.enabled ? 'Click to disable' : 'Click to enable'}
                        style={{
                          width: 32, height: 18, borderRadius: 9, border: 'none',
                          background: theme.enabled ? 'var(--maroon-700)' : 'var(--ink-200)',
                          position: 'relative', cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 2, left: theme.enabled ? 16 : 2,
                          width: 14, height: 14, borderRadius: 7, background: 'var(--white)',
                          transition: 'left 0.15s ease',
                        }} />
                      </button>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>
                          {theme.title || <span style={{ color: 'var(--ink-300)' }}>(untitled)</span>}
                          {isUserAdded && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 500, color: 'var(--ink-400)' }}>custom</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                          {theme.briefIds.map(bid => (
                            <span key={bid} style={{
                              fontSize: 10, padding: '2px 7px', borderRadius: 'var(--r-xs)',
                              background: 'var(--white)', border: '1px solid var(--ink-200)', color: 'var(--ink-600)',
                            }}>
                              {BRIEF_LABELS[bid] || bid}
                            </span>
                          ))}
                        </div>
                      </div>

                      <button style={{ ...btnG, padding: '5px 9px' }} onClick={() => startEdit(theme)}>
                        <Edit3 size={11} /> Edit
                      </button>
                      {isUserAdded && (
                        <button style={{ ...btnDanger, padding: '5px 9px' }} onClick={() => setConfirmDeleteTheme(theme)}>
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {/* Edit modal */}
      {editing && (
        <Modal onClose={() => { setEditing(null); setEditingIsNew(false); }}>
          <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-900)' }}>
              {editingIsNew ? 'New theme' : 'Edit theme'}
            </div>
            <button onClick={() => { setEditing(null); setEditingIsNew(false); }} style={{ ...btnG, padding: '4px 8px' }}><X size={14} /></button>
          </div>

          <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
            <Field label="Title">
              <input
                type="text"
                value={editing.title}
                onChange={e => setEditing({ ...editing, title: e.target.value })}
                style={inp}
                placeholder="e.g. Weekend market spotlight"
              />
            </Field>

            <Field label="Category">
              <select
                value={editing.category}
                onChange={e => setEditing({ ...editing, category: e.target.value as ThemeCategory })}
                style={inp}
              >
                {THEME_CATEGORIES.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Prompt">
              <textarea
                value={editing.prompt}
                onChange={e => setEditing({ ...editing, prompt: e.target.value })}
                rows={4}
                style={{ ...inp, resize: 'vertical' }}
                placeholder="Describe the angle — what should the generator write about?"
              />
            </Field>

            <Field label="Briefs">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(BRIEF_LABELS).map(([id, label]) => {
                  const on = editing.briefIds.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setEditing({
                          ...editing,
                          briefIds: on
                            ? editing.briefIds.filter(b => b !== id)
                            : [...editing.briefIds, id],
                        });
                      }}
                      style={{
                        ...btnG,
                        background: on ? 'var(--maroon-700)' : 'var(--white)',
                        color: on ? 'var(--white)' : 'var(--ink-700)',
                        borderColor: on ? 'var(--maroon-700)' : 'var(--ink-200)',
                      }}
                    >
                      {on && <Check size={11} />} {label}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-400)', marginTop: 4 }}>
                At least one brief required.
              </div>
            </Field>

            <Field label="Enabled">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={e => setEditing({ ...editing, enabled: e.target.checked })}
                />
                <span style={{ fontSize: 12, color: 'var(--ink-700)' }}>
                  Available to the generator
                </span>
              </label>
            </Field>
          </div>

          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button style={btnG} onClick={() => { setEditing(null); setEditingIsNew(false); }}>Cancel</button>
            <button
              style={btnP}
              onClick={saveEdit}
              disabled={!editing.title.trim() || !editing.prompt.trim() || editing.briefIds.length === 0}
            >
              <Save size={12} /> Save theme
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm dialogs */}
      {confirmResetTimes && (
        <ConfirmDialog
          title="Reset posting times?"
          body="This restores the default schedule (LinkedIn: Tue/Wed/Thu × 8:00, 12:00 · Facebook: Wed/Fri × 13:00, Sun × 10:00 · Instagram: daily × 11:00, 19:00). Themes are not affected."
          confirmLabel="Reset times"
          onCancel={() => setConfirmResetTimes(false)}
          onConfirm={async () => {
            // Reset just times by writing the defaults explicitly — keeps theme overrides intact.
            const { DEFAULT_POSTING_TIMES } = await import('@/lib/social-settings-types');
            setConfirmResetTimes(false);
            putPartial({ postingTimes: DEFAULT_POSTING_TIMES });
          }}
        />
      )}

      {confirmResetThemes && (
        <ConfirmDialog
          title="Reset themes to defaults?"
          body="This restores all 25 seed themes and removes any custom themes you added. Posting times are not affected."
          confirmLabel="Reset themes"
          onCancel={() => setConfirmResetThemes(false)}
          onConfirm={() => {
            setConfirmResetThemes(false);
            // Empty overrides == defaults from seed.
            putOverridesRaw({ enabled: {}, edits: {}, additions: [], deletions: [] });
          }}
        />
      )}

      {confirmDeleteTheme && (
        <ConfirmDialog
          title={`Delete "${confirmDeleteTheme.title}"?`}
          body="This removes the theme from the generator. You can re-add it from scratch later."
          confirmLabel="Delete"
          onCancel={() => setConfirmDeleteTheme(null)}
          onConfirm={() => deleteUserTheme(confirmDeleteTheme)}
        />
      )}
    </div>
  );
}

// ---------- small components ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function AddCustomTime({ onAdd }: { onAdd: (time: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="HH:MM"
        style={{ ...inp, width: 100, padding: '6px 10px', fontSize: 12 }}
      />
      <button
        type="button"
        style={btnG}
        onClick={() => {
          if (!value.trim()) return;
          onAdd(value);
          setValue('');
        }}
      >
        <Plus size={12} /> Add time
      </button>
      <div style={{ fontSize: 10, color: 'var(--ink-400)', marginLeft: 4 }}>
        24h format. Defaults to every day — untoggle days you don&apos;t want.
      </div>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(26,13,18,0.5)', zIndex: 500,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--white)', borderRadius: 'var(--r-xl)', width: 560, maxWidth: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)',
      }}>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({
  title, body, confirmLabel, onConfirm, onCancel,
}: {
  title: string; body: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel}>
      <div style={{ padding: 24 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--ink-900)' }}>{title}</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 20 }}>{body}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={btnG} onClick={onCancel}>Cancel</button>
          <button style={btnP} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
