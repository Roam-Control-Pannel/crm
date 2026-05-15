'use client';
import { useState, useEffect } from 'react';
import { Edit3, Pause, Play, RefreshCw, AlertTriangle, Check, X } from 'lucide-react';
import { Brief, fetchBriefs } from '@/lib/briefs';
import { RealAccount, SocialAccount, AccountMeta, fetchRealAccounts, combineAccounts, upsertAccountMeta, fetchAccountMeta } from '@/lib/social-accounts';

const inp = {
  width: '100%',
  padding: '8px 12px',
  border: '1.5px solid var(--ink-200)',
  borderRadius: 'var(--r-sm)',
  fontSize: 13,
  fontFamily: 'inherit',
  background: 'var(--white)',
} as const;

const btnG = {
  padding: '7px 14px',
  borderRadius: 'var(--r-sm)',
  border: '1.5px solid var(--ink-200)',
  background: 'var(--white)',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--ink-700)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'inherit',
} as const;

const btnP = {
  padding: '7px 14px',
  borderRadius: 'var(--r-sm)',
  border: 'none',
  background: 'var(--maroon-700)',
  color: 'var(--white)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'inherit',
} as const;

function PlatformIcon({ platform, size = 14 }: { platform: string; size?: number }) {
  // Inline SVG brand glyphs — lucide doesn't export these
  const s = size;
  if (platform === 'linkedin') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.13 2.06 2.06 0 010 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/></svg>
    );
  }
  if (platform === 'facebook') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
    );
  }
  if (platform === 'instagram') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
    );
  }
  return null;
}

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
};

const TYPE_LABEL: Record<string, string> = {
  personal: 'Personal',
  company: 'Company',
  page: 'Page',
};

export default function AccountsPage() {
  const [realAccounts, setRealAccounts] = useState<RealAccount[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [accountMeta, setAccountMeta] = useState<AccountMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SocialAccount | null>(null);
  // MULTI-BRIEF-V1: editForm tracks multiple briefIds + per-brief overrides.
  // Legacy flat tone/hashtags/content fields are still here so a single-brief
  // account upgrade saves both shapes (forwards + backwards compat).
  const [editForm, setEditForm] = useState<{
    briefIds: string[];
    perBriefOverrides: Record<string, { tone: string; hashtags: string; contentBrief: string }>;
    expandedBriefId: string | null;
  }>({
    briefIds: [],
    perBriefOverrides: {},
    expandedBriefId: null,
  });

  async function load() {
    setLoading(true);
    const [real, briefsData, metas] = await Promise.all([
      fetchRealAccounts(),
      fetchBriefs(),
      fetchAccountMeta(),
    ]);
    setRealAccounts(real);
    setBriefs(briefsData);
    setAccountMeta(metas);
    setAccounts(combineAccounts(real, briefsData, metas));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openEdit(a: SocialAccount) {
    setEditing(a);
    // Hydrate per-brief overrides for every brief currently assigned.
    // For each brief, prefer perBriefOverrides[id], fall back to the
    // legacy flat fields (which only meaningfully apply to brief 0).
    const perBrief: Record<string, { tone: string; hashtags: string; contentBrief: string }> = {};
    const briefIds = a.briefIds || [];
    briefIds.forEach((id, idx) => {
      const fromMap = a.perBriefOverrides?.[id];
      if (fromMap) {
        perBrief[id] = {
          tone: fromMap.tone || '',
          hashtags: fromMap.hashtags || '',
          contentBrief: fromMap.contentBrief || '',
        };
      } else if (idx === 0) {
        // Legacy: flat overrides only describe the first brief.
        perBrief[id] = {
          tone: a.toneOverride || '',
          hashtags: a.hashtagsOverride || '',
          contentBrief: a.contentBriefOverride || '',
        };
      } else {
        perBrief[id] = { tone: '', hashtags: '', contentBrief: '' };
      }
    });
    setEditForm({
      briefIds,
      perBriefOverrides: perBrief,
      expandedBriefId: briefIds[0] || null,
    });
  }

  async function saveEdit() {
    if (!editing) return;
    // Strip empty per-brief overrides so we don't store noise.
    const cleanedOverrides: Record<string, { tone?: string; hashtags?: string; contentBrief?: string }> = {};
    for (const id of editForm.briefIds) {
      const o = editForm.perBriefOverrides[id];
      if (!o) continue;
      const trimmed = {
        tone: o.tone?.trim() || undefined,
        hashtags: o.hashtags?.trim() || undefined,
        contentBrief: o.contentBrief?.trim() || undefined,
      };
      if (trimmed.tone || trimmed.hashtags || trimmed.contentBrief) {
        cleanedOverrides[id] = trimmed;
      }
    }
    // MULTI-BRIEF-V1: write new shape (briefIds + perBriefOverrides)
    // AND legacy mirror (briefId + flat fields from brief[0]) so a
    // rollback of this patch wouldn't corrupt anything.
    const firstId = editForm.briefIds[0];
    const firstOverride = firstId ? cleanedOverrides[firstId] : undefined;
    const updated = await upsertAccountMeta({
      accountId: editing.id,
      briefIds: editForm.briefIds.length > 0 ? editForm.briefIds : undefined,
      perBriefOverrides: Object.keys(cleanedOverrides).length > 0 ? cleanedOverrides : undefined,
      // Legacy mirrors:
      briefId: firstId || undefined,
      toneOverride: firstOverride?.tone,
      hashtagsOverride: firstOverride?.hashtags,
      contentBriefOverride: firstOverride?.contentBrief,
    });
    setAccountMeta(updated);
    setAccounts(combineAccounts(realAccounts, briefs, updated));
    setEditing(null);
  }

  async function toggleActive(a: SocialAccount) {
    const updated = await upsertAccountMeta({ accountId: a.id, active: !a.active });
    setAccountMeta(updated);
    setAccounts(combineAccounts(realAccounts, briefs, updated));
  }

  // Group accounts by platform for display
  const byPlatform = {
    linkedin: accounts.filter(a => a.platform === 'linkedin'),
    facebook: accounts.filter(a => a.platform === 'facebook'),
    instagram: accounts.filter(a => a.platform === 'instagram'),
  };

  const totalActive = accounts.filter(a => a.active && a.capabilities.canPost).length;
  const totalPending = accounts.filter(a => a.pendingApproval).length;

  return (
    <div className="page-wrap">
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1 }}>Social Accounts</h1>
          <p style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 5, fontWeight: 500 }}>
            {loading ? 'Loading…' : `${totalActive} active · ${accounts.length} total${totalPending ? ` · ${totalPending} pending` : ''} · auto-discovered from your connections`}
          </p>
        </div>
        <div className="btn-row">
          <button onClick={load} style={btnG}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-400)' }}>Loading accounts…</div>
      ) : accounts.length === 0 ? (
        <div style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', padding: 40, textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
          <AlertTriangle size={28} color="var(--ink-300)" style={{ margin: '0 auto 12px', display: 'block' }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-700)', marginBottom: 8 }}>No accounts connected yet</h3>
          <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 18, lineHeight: 1.5 }}>
            Head to <strong>Channels</strong> to connect LinkedIn, Facebook, or Instagram.<br />
            Each connection will appear here as a posting destination.
          </p>
          <a href="/channels" style={{ ...btnP, textDecoration: 'none' }}>Go to Channels →</a>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
          {accounts.map(a => (
            <div
              key={a.id}
              style={{
                background: 'var(--white)',
                borderRadius: 'var(--r-lg)',
                padding: 16,
                boxShadow: 'var(--shadow-sm)',
                opacity: a.pendingApproval ? 0.7 : 1,
                border: a.pendingApproval ? '1.5px dashed var(--ink-200)' : '1px solid transparent',
                position: 'relative',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: a.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  <PlatformIcon platform={a.platform} size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.handle}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>
                    {PLATFORM_LABEL[a.platform]} · {TYPE_LABEL[a.type]}{a.region ? ` · ${a.region}` : ''}
                  </div>
                </div>
                <div style={{ flexShrink: 0 }}>
                  {a.pendingApproval ? (
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--warn)', background: '#fef3c7', padding: '3px 8px', borderRadius: 'var(--r-pill)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AlertTriangle size={10} />Pending
                    </div>
                  ) : a.active ? (
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ok)', background: '#e8f5ee', padding: '3px 8px', borderRadius: 'var(--r-pill)' }}>● Active</div>
                  ) : (
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-500)', background: 'var(--paper)', padding: '3px 8px', borderRadius: 'var(--r-pill)' }}>Paused</div>
                  )}
                </div>
              </div>

              {/* MULTI-BRIEF-V1: show all assigned brief chips */}
              <div style={{ marginBottom: 10 }}>
                {a.briefs.length > 0 ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {a.briefs.map(b => (
                      <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 'var(--r-sm)', background: b.color + '12', border: `1px solid ${b.color}33` }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: b.color }} />
                        <div style={{ fontSize: 11, fontWeight: 600, color: b.color }}>{b.name}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--ink-400)', fontStyle: 'italic', padding: '6px 10px' }}>
                    No brief assigned
                  </div>
                )}
              </div>

              {/* Pending message */}
              {a.pendingApproval && (
                <div style={{ fontSize: 11, color: 'var(--ink-500)', lineHeight: 1.5, marginBottom: 12, padding: '8px 10px', background: 'var(--paper)', borderRadius: 'var(--r-sm)' }}>
                  Awaiting LinkedIn Community Management API approval. Once granted, this account will activate automatically.
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                <button onClick={() => openEdit(a)} disabled={a.pendingApproval} style={{ ...btnG, flex: 1, opacity: a.pendingApproval ? 0.5 : 1 }}>
                  <Edit3 size={11} /> {a.briefIds.length > 0 ? 'Edit' : 'Assign brief'}
                </button>
                {!a.pendingApproval && (
                  <button onClick={() => toggleActive(a)} style={btnG}>
                    {a.active ? <><Pause size={11} /> Pause</> : <><Play size={11} /> Resume</>}
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Connect more — Facebook prompt */}
          {byPlatform.facebook.length === 0 && (
            <a
              href="/channels"
              style={{
                background: 'var(--white)',
                borderRadius: 'var(--r-lg)',
                padding: 16,
                boxShadow: 'var(--shadow-sm)',
                border: '1.5px dashed var(--ink-200)',
                textDecoration: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 180,
                color: 'var(--ink-700)',
                gap: 8,
              }}
            >
              <svg width={28} height={28} viewBox="0 0 24 24" fill="var(--ink-300)"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Connect Facebook</div>
              <div style={{ fontSize: 11, color: 'var(--ink-400)', textAlign: 'center', lineHeight: 1.5 }}>
                Discover Pages & Instagram<br />Business accounts
              </div>
            </a>
          )}
        </div>
      )}

      {/* Edit modal.
          Layout: panel is a flex column with a hard height cap. Header and
          footer don't shrink; body takes the remaining space with
          min-height:0 so it can shrink below its intrinsic content size,
          which is what lets overflow-y:auto actually engage. Earlier
          patches tried absolute-positioning the body (Patch 7.4) which
          looked right on paper but didn't scroll in practice — the
          min-height:0 flex pattern is the textbook fix and works here as
          long as we don't fight it from the parent .soc-modal-panel
          (hence the inline display:flex below, overriding the class). */}
      {editing && (
        <div
          className="soc-modal-overlay"
          style={{ zIndex: 500, overflow: 'hidden' }}
          onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}
        >
          <div
            className="soc-modal-panel"
            style={{
              width: 540,
              maxWidth: '100%',
              maxHeight: 'min(90vh, 800px)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '18px 22px 14px',
                borderBottom: '1px solid var(--ink-100)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-900)' }}>Account settings</div>
                <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>{editing.handle} · {PLATFORM_LABEL[editing.platform]}</div>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close account settings"
                style={{ ...btnG, padding: '4px 8px' }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>

            <div
              style={{
                // No flex-grow: panel uses max-height (not height), so there
                // is no "remaining space" for grow to consume — basis:0 +
                // grow:1 collapses the body to 0. Letting flex-basis: auto
                // sizes the body to its content; combined with min-height:0
                // it still shrinks when the panel hits its 90vh cap, which
                // is when overflow-y:auto engages.
                flex: '0 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '18px 22px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {/* MULTI-BRIEF-V1: checkbox multi-select for briefs */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Briefs <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-400)' }}>(pick one or more)</span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {briefs.map(b => {
                    const selected = editForm.briefIds.includes(b.id);
                    return (
                      <label
                        key={b.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '9px 12px',
                          borderRadius: 'var(--r-sm)',
                          background: selected ? b.color + '12' : 'var(--white)',
                          border: `1.5px solid ${selected ? b.color + '55' : 'var(--ink-200)'}`,
                          cursor: 'pointer',
                          transition: 'background 0.15s, border-color 0.15s',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            setEditForm(prev => {
                              const nextIds = selected
                                ? prev.briefIds.filter(id => id !== b.id)
                                : [...prev.briefIds, b.id];
                              const nextOverrides = { ...prev.perBriefOverrides };
                              if (selected) {
                                delete nextOverrides[b.id];
                              } else if (!nextOverrides[b.id]) {
                                nextOverrides[b.id] = { tone: '', hashtags: '', contentBrief: '' };
                              }
                              return {
                                briefIds: nextIds,
                                perBriefOverrides: nextOverrides,
                                expandedBriefId: prev.expandedBriefId || nextIds[0] || null,
                              };
                            });
                          }}
                          style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                        />
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{b.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.description}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {editForm.briefIds.length > 1 && (
                <a
                  href="/social/settings#brief-weights"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--paper)',
                    border: '1px solid var(--ink-200)',
                    textDecoration: 'none',
                    color: 'var(--ink-700)',
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    With {editForm.briefIds.length} briefs assigned, the cron mixes them per post.
                    Default is equal weighting. <strong style={{ color: 'var(--maroon-700)' }}>Edit ratios in Social Settings →</strong>
                  </div>
                </a>
              )}
              {editForm.briefIds.length > 0 && (
                <>
                  <div style={{ height: 1, background: 'var(--ink-100)' }} />

                  <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                    Account-level overrides <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-400)' }}>(optional, per brief)</span>
                  </div>

                  {/* MULTI-BRIEF-V1: collapsible per-brief override sections */}
                  {editForm.briefIds.map(briefId => {
                    const b = briefs.find(x => x.id === briefId);
                    if (!b) return null;
                    const expanded = editForm.expandedBriefId === briefId;
                    const o = editForm.perBriefOverrides[briefId] || { tone: '', hashtags: '', contentBrief: '' };
                    return (
                      <div key={briefId} style={{ border: '1px solid var(--ink-100)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                        <button
                          type="button"
                          onClick={() => setEditForm(prev => ({ ...prev, expandedBriefId: expanded ? null : briefId }))}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: b.color + '08', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                        >
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: b.color }} />
                          <div style={{ fontSize: 12, fontWeight: 600, color: b.color, flex: 1 }}>{b.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--ink-500)' }}>{expanded ? 'Hide' : 'Show'} overrides</div>
                        </button>
                        {expanded && (
                          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--white)' }}>
                            <div style={{ padding: '8px 10px', background: b.color + '0a', borderRadius: 'var(--r-sm)', fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.5 }}>
                              <div style={{ marginBottom: 3 }}><strong>Audience:</strong> {b.audience}</div>
                              <div style={{ marginBottom: 3 }}><strong>Tone:</strong> {b.tone}</div>
                              <div><strong>Content:</strong> {b.contentBrief}</div>
                            </div>

                            <div>
                              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tone override</label>
                              <input
                                value={o.tone}
                                onChange={e => setEditForm(prev => ({ ...prev, perBriefOverrides: { ...prev.perBriefOverrides, [briefId]: { ...o, tone: e.target.value } } }))}
                                placeholder="Leave blank to use brief's tone"
                                style={inp}
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Hashtags override</label>
                              <input
                                value={o.hashtags}
                                onChange={e => setEditForm(prev => ({ ...prev, perBriefOverrides: { ...prev.perBriefOverrides, [briefId]: { ...o, hashtags: e.target.value } } }))}
                                placeholder="Leave blank to use brief defaults"
                                style={inp}
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Content brief override</label>
                              <textarea
                                value={o.contentBrief}
                                onChange={e => setEditForm(prev => ({ ...prev, perBriefOverrides: { ...prev.perBriefOverrides, [briefId]: { ...o, contentBrief: e.target.value } } }))}
                                rows={3}
                                placeholder="Leave blank to use brief's content guidance"
                                style={{ ...inp, resize: 'vertical' }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            <div
              style={{
                padding: '14px 22px',
                borderTop: '1px solid var(--ink-100)',
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                flexShrink: 0,
              }}
            >
              <button type="button" onClick={() => setEditing(null)} style={btnG}>Cancel</button>
              <button type="button" onClick={saveEdit} style={btnP}><Check size={13} aria-hidden="true" /> Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
