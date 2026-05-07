'use client';
import { useState, useEffect } from 'react';
import { Edit3, Pause, Play, RefreshCw, AlertTriangle, Check, X } from 'lucide-react';
import { Brief, getBriefs } from '@/lib/briefs';
import { RealAccount, SocialAccount, fetchRealAccounts, combineAccounts, upsertAccountMeta } from '@/lib/social-accounts';

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
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SocialAccount | null>(null);
  const [editForm, setEditForm] = useState({
    briefId: '',
    toneOverride: '',
    hashtagsOverride: '',
    contentBriefOverride: '',
  });

  async function load() {
    setLoading(true);
    const [real] = await Promise.all([fetchRealAccounts()]);
    const briefsData = getBriefs();
    setRealAccounts(real);
    setBriefs(briefsData);
    setAccounts(combineAccounts(real, briefsData));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openEdit(a: SocialAccount) {
    setEditing(a);
    setEditForm({
      briefId: a.briefId || '',
      toneOverride: a.toneOverride || '',
      hashtagsOverride: a.hashtagsOverride || '',
      contentBriefOverride: a.contentBriefOverride || '',
    });
  }

  function saveEdit() {
    if (!editing) return;
    upsertAccountMeta({
      accountId: editing.id,
      briefId: editForm.briefId || undefined,
      toneOverride: editForm.toneOverride || undefined,
      hashtagsOverride: editForm.hashtagsOverride || undefined,
      contentBriefOverride: editForm.contentBriefOverride || undefined,
    });
    setAccounts(combineAccounts(realAccounts, briefs));
    setEditing(null);
  }

  function toggleActive(a: SocialAccount) {
    upsertAccountMeta({ accountId: a.id, active: !a.active });
    setAccounts(combineAccounts(realAccounts, briefs));
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
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1 }}>Social Accounts</h1>
          <p style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 5, fontWeight: 500 }}>
            {loading ? 'Loading…' : `${totalActive} active · ${accounts.length} total${totalPending ? ` · ${totalPending} pending` : ''} · auto-discovered from your connections`}
          </p>
        </div>
        <button onClick={load} style={btnG}><RefreshCw size={13} /> Refresh</button>
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

              {/* Brief assignment */}
              <div style={{ marginBottom: 10 }}>
                {a.brief ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 'var(--r-sm)', background: a.brief.color + '12', border: `1px solid ${a.brief.color}33` }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.brief.color }} />
                    <div style={{ fontSize: 11, fontWeight: 600, color: a.brief.color }}>{a.brief.name}</div>
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
                  <Edit3 size={11} /> {a.briefId ? 'Edit' : 'Assign brief'}
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

      {/* Edit modal */}
      {editing && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(26,13,18,0.5)',
            zIndex: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}
        >
          <div style={{ background: 'var(--white)', borderRadius: 'var(--r-xl)', width: 540, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-900)' }}>Account settings</div>
                <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>{editing.handle} · {PLATFORM_LABEL[editing.platform]}</div>
              </div>
              <button onClick={() => setEditing(null)} style={{ ...btnG, padding: '4px 8px' }}><X size={14} /></button>
            </div>

            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brief</label>
                <select value={editForm.briefId} onChange={e => setEditForm({ ...editForm, briefId: e.target.value })} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">— Unassigned —</option>
                  {briefs.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {editForm.briefId && (() => {
                  const b = briefs.find(x => x.id === editForm.briefId);
                  if (!b) return null;
                  return (
                    <div style={{ marginTop: 8, padding: '10px 12px', background: b.color + '0a', borderRadius: 'var(--r-sm)', fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.5 }}>
                      <div style={{ marginBottom: 4 }}><strong>Audience:</strong> {b.audience}</div>
                      <div style={{ marginBottom: 4 }}><strong>Tone:</strong> {b.tone}</div>
                      <div><strong>Content:</strong> {b.contentGuidance}</div>
                    </div>
                  );
                })()}
              </div>

              <div style={{ height: 1, background: 'var(--ink-100)' }} />

              <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Account-level overrides <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-400)' }}>(optional)</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tone override</label>
                <input value={editForm.toneOverride} onChange={e => setEditForm({ ...editForm, toneOverride: e.target.value })} placeholder="Leave blank to use brief's tone" style={inp} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Hashtags override</label>
                <input value={editForm.hashtagsOverride} onChange={e => setEditForm({ ...editForm, hashtagsOverride: e.target.value })} placeholder="Leave blank to use brief defaults" style={inp} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Content brief override</label>
                <textarea value={editForm.contentBriefOverride} onChange={e => setEditForm({ ...editForm, contentBriefOverride: e.target.value })} rows={3} placeholder="Leave blank to use brief's content guidance" style={{ ...inp, resize: 'vertical' }} />
              </div>
            </div>

            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--ink-100)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={btnG}>Cancel</button>
              <button onClick={saveEdit} style={btnP}><Check size={13} /> Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
