'use client';
import { useState, useEffect } from 'react';
import { Plus, X, Edit3, Trash2, Check, Sparkles, Layers } from 'lucide-react';
import { Brief, fetchBriefs, persistBriefs, DEFAULT_BRIEFS } from '@/lib/briefs';

interface SocialAccount {
  id: string;
  handle: string;
  platform: string;
  region?: string;
  briefId?: string;
  active: boolean;
}

const COLORS = ['#9b2752','#185FA5','#3b5998','#2f7a4f','#c47a1a','#7c3aed','#0891b2','#dc2626','#0A66C2','#0891b2'];

const btnP: React.CSSProperties = { padding: '8px 14px', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--maroon-700)', color: 'var(--white)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 };
const btnG: React.CSSProperties = { padding: '6px 12px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--ink-200)', background: 'var(--white)', fontSize: 11, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 };

function blankBrief(): Brief {
  return {
    id: 'brief-' + Date.now(),
    name: '',
    description: '',
    audience: '',
    tone: '',
    contentBrief: '',
    hashtags: '',
    color: COLORS[0],
    active: true,
    createdAt: new Date().toISOString(),
    brandVoice: '',
  };
}

export default function BriefsPage() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Brief | null>(null);
  const [form, setForm] = useState<Brief>(blankBrief());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchBriefs();
      if (!cancelled) setBriefs(data);

      // Real accounts come from the social-accounts API + per-account meta.
      try {
        const [accRes, metaRes] = await Promise.all([
          fetch('/api/accounts/status'),
          fetch('/api/store/account_meta'),
        ]);
        const accJson = accRes.ok ? await accRes.json() : { realAccounts: [] };
        const metaJson = metaRes.ok ? await metaRes.json() : { data: [] };
        const metas: Array<{ accountId: string; briefId?: string; active?: boolean }> = metaJson?.data || [];
        const real = (accJson.realAccounts || []) as Array<{ id: string; handle: string; platform: string; region?: string }>;
        const merged: SocialAccount[] = real.map(r => {
          const m = metas.find(x => x.accountId === r.id);
          return { id: r.id, handle: r.handle, platform: r.platform, region: r.region, briefId: m?.briefId, active: m?.active !== false };
        });
        if (!cancelled) setAccounts(merged);
      } catch (err) {
        console.error('Failed to load accounts for briefs page:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function persist(next: Brief[]) {
    setBriefs(next);
    persistBriefs(next).catch(err => console.error('Failed to save briefs:', err));
  }

  function openNew() {
    setEditing(null);
    setForm(blankBrief());
    setShowEditor(true);
  }
  function openEdit(b: Brief) {
    setEditing(b);
    setForm({ ...b });
    setShowEditor(true);
  }
  function save() {
    if (!form.name.trim()) return;
    if (editing) {
      persist(briefs.map(b => b.id === editing.id ? form : b));
    } else {
      persist([...briefs, form]);
    }
    setShowEditor(false);
  }
  function remove(b: Brief) {
    if (!confirm(`Delete brief "${b.name}"? Posts assigned to this brief will lose their assignment.`)) return;
    persist(briefs.filter(x => x.id !== b.id));
  }

  return (
    <main className="page-wrap" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ fontWeight: 700, fontFamily: 'var(--font-serif)', color: 'var(--ink-900)' }}>Briefs</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 6 }}>Strategic content tracks. Each brief targets one or more social accounts and defines the voice for posts under it.</p>
        </div>
        <div className="btn-row">
          <button style={btnP} onClick={openNew}><Plus size={13} /> New brief</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {briefs.map(b => {
          const linked = accounts.filter(a => a.briefId === b.id);
          return (
            <div key={b.id} style={{ background: 'var(--white)', border: '1px solid var(--ink-100)', borderRadius: 'var(--r-lg)', padding: 18, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: b.color }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 'var(--r-sm)', background: b.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Layers size={18} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-900)' }}>{b.name}</h3>
                  <p style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>{b.description}</p>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-500)', marginBottom: 10 }}><strong>Tone:</strong> {b.tone}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-500)', marginBottom: 10 }}><strong>Audience:</strong> {b.audience}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-500)', marginBottom: 12 }}><strong>Hashtags:</strong> {b.hashtags || <em>none</em>}</div>

              <div style={{ borderTop: '1px solid var(--ink-100)', paddingTop: 10, marginTop: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Linked accounts ({linked.length})</div>
                {linked.length === 0
                  ? <div style={{ fontSize: 11, color: 'var(--ink-400)', fontStyle: 'italic' }}>No accounts assigned. Go to Social Accounts to link them.</div>
                  : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {linked.map(a => (
                        <span key={a.id} style={{ fontSize: 10, padding: '3px 7px', borderRadius: 'var(--r-pill)', background: 'var(--ink-100)', color: 'var(--ink-700)' }}>{a.handle} <span style={{ color: 'var(--ink-400)' }}>· {a.platform}</span></span>
                      ))}
                    </div>
                }
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 14, justifyContent: 'flex-end' }}>
                <button style={btnG} onClick={() => openEdit(b)}><Edit3 size={11} /> Edit</button>
                <button style={{ ...btnG, color: 'var(--alert)', borderColor: '#f5c2c7' }} onClick={() => remove(b)}><Trash2 size={11} /></button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Editor Modal */}
      {showEditor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,13,18,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setShowEditor(false); }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', width: 'min(580px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700 }}>{editing ? 'Edit brief' : 'New brief'}</h2>
              <button onClick={() => setShowEditor(false)} style={{ ...btnG, padding: '4px 8px' }}><X size={14} /></button>
            </div>

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Roam Local" style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 13, marginTop: 4, marginBottom: 12 }} />

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</label>
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Short description shown on the card" style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 13, marginTop: 4, marginBottom: 12 }} />

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Audience</label>
            <textarea value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })} placeholder="Who is this content for?" rows={2} style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 13, marginTop: 4, marginBottom: 12, fontFamily: 'inherit', resize: 'vertical' }} />

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tone of voice</label>
            <input value={form.tone} onChange={e => setForm({ ...form, tone: e.target.value })} placeholder="e.g. Warm, visual, discovery-led" style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 13, marginTop: 4, marginBottom: 12 }} />

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Content brief</label>
            <textarea value={form.contentBrief} onChange={e => setForm({ ...form, contentBrief: e.target.value })} placeholder="What kind of content lives in this track?" rows={3} style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 13, marginTop: 4, marginBottom: 12, fontFamily: 'inherit', resize: 'vertical' }} />

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Brand voice guide</label>
            <textarea
              value={form.brandVoice || ''}
              onChange={e => setForm({ ...form, brandVoice: e.target.value })}
              placeholder={'Phrasing, vocabulary, do/don\'ts, taglines. Anything the AI should follow when writing for this brand.\n\nExample:\n- Always use "discover", never "find"\n- Sentence-case headings, never title-case\n- Avoid corporate jargon — write like a knowledgeable friend\n- Tagline: "Discover the best of your town"'}
              rows={8}
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 13, marginTop: 4, marginBottom: 4, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
            />
            <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginBottom: 12 }}>
              Roam-io reads this whenever writing or rewriting content for this brief.
            </div>

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Hashtags</label>
            <input value={form.hashtags} onChange={e => setForm({ ...form, hashtags: e.target.value })} placeholder="#RoamLocal #HiddenGems" style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--ink-200)', borderRadius: 'var(--r-sm)', fontSize: 13, marginTop: 4, marginBottom: 12, fontFamily: 'inherit' }} />

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Colour</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {COLORS.map(col => (
                <button key={col} type="button" onClick={() => setForm({ ...form, color: col })} style={{ width: 28, height: 28, borderRadius: '50%', background: col, border: form.color === col ? '3px solid var(--ink-900)' : '2px solid var(--white)', boxShadow: '0 0 0 1px var(--ink-200)', cursor: 'pointer' }} />
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowEditor(false)} style={btnG}>Cancel</button>
              <button onClick={save} disabled={!form.name.trim()} style={{ ...btnP, opacity: !form.name.trim() ? 0.5 : 1 }}><Check size={13} /> {editing ? 'Save changes' : 'Create brief'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
