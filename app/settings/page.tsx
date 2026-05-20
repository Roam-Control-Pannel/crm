'use client';
import { useState, useEffect, useCallback } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { Mail, Clock, EyeOff, Activity, User, LogOut, Check, AlertCircle, RefreshCw, Eye } from 'lucide-react';

interface AppSettings {
  sender: { name: string; email: string; replyTo: string };
  cadence: { followUpDays: number; finalNudgeDays: number; coldDays: number; dailySendCap: number };
}

interface Diagnostics {
  brevo: { ok: boolean; email?: string; error?: string };
  cron: {
    lastRun: null | { ranAt: string; ok: boolean; message: string; day2Sent: number; day7Sent: number; day14Cold: number; errors: number; capped: boolean };
    sendsToday: number;
    dailyCap: number;
  };
  hiddenLists: number;
}

interface BrevoList { id: number; name: string; uniqueSubscribers?: number }

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [lists, setLists] = useState<BrevoList[]>([]);
  const [hiddenIds, setHiddenIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, d, l, h] = await Promise.all([
      fetch('/api/settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      fetch('/api/settings/diagnostics', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      fetch('/api/brevo/lists', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      fetch('/api/lists/hidden', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
    ]);
    if (s) setSettings(s);
    if (d) setDiag(d);
    if (l) setLists(l.lists || []);
    if (h) setHiddenIds(h.hiddenListIds || []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="page-wrap" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Workspace-level preferences. Changes apply on the next send / cron run.</p>
        </div>
        <button onClick={refresh} disabled={loading} className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <RefreshCw size={12} style={loading ? { animation: 'spin 0.8s linear infinite' } : undefined} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <ProfilePanel
        name={session?.user?.name || 'Roam Admin'}
        email={session?.user?.email || ''}
        diag={diag}
      />

      {settings && <SenderPanel settings={settings} onSaved={setSettings} />}
      {settings && <CadencePanel settings={settings} onSaved={setSettings} />}
      <HiddenListsPanel
        lists={lists}
        hiddenIds={hiddenIds}
        onChange={async (next) => {
          setHiddenIds(next);
          await fetch('/api/lists/hidden', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hiddenListIds: next }) });
        }}
      />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon}
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-800)' }}>{title}</span>
        </div>
      </div>
      <div style={{ padding: '18px' }}>{children}</div>
    </div>
  );
}

function ProfilePanel({ name, email, diag }: { name: string; email: string; diag: Diagnostics | null }) {
  return (
    <Panel icon={<Activity size={14} color="var(--ink-600)" />} title="Profile & connection">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#9b2752', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
          {name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-900)' }}>{name}</div>
          {email && <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{email}</div>}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="btn-ghost"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}
        >
          <LogOut size={12} /> Sign out
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <StatusTile
          label="Brevo connection"
          ok={diag?.brevo.ok ?? null}
          value={diag?.brevo.ok ? (diag.brevo.email || 'Connected') : (diag?.brevo.error || 'Not connected')}
        />
        <StatusTile
          label="Sends today"
          ok={diag ? diag.cron.sendsToday < diag.cron.dailyCap : null}
          value={diag ? `${diag.cron.sendsToday} / ${diag.cron.dailyCap}` : '—'}
        />
        <StatusTile
          label="Last cron run"
          ok={diag?.cron.lastRun ? diag.cron.lastRun.ok : null}
          value={diag?.cron.lastRun ? `${timeAgo(diag.cron.lastRun.ranAt)} · ${diag.cron.lastRun.day2Sent + diag.cron.lastRun.day7Sent} sent` : 'never'}
        />
        <StatusTile
          label="Hidden lists"
          ok={null}
          value={diag ? String(diag.hiddenLists) : '—'}
        />
      </div>
    </Panel>
  );
}

function StatusTile({ label, ok, value }: { label: string; ok: boolean | null; value: string }) {
  const colour = ok === null ? 'var(--ink-500)' : ok ? '#2f7a4f' : '#b53939';
  return (
    <div style={{ padding: 12, background: 'var(--paper)', border: '1px solid var(--ink-100)', borderRadius: 'var(--r-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {ok === true && <Check size={10} color={colour} />}
        {ok === false && <AlertCircle size={10} color={colour} />}
        {label}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: colour, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
    </div>
  );
}

function SenderPanel({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const [form, setForm] = useState(settings.sender);
  const [state, setState] = useState<SaveState>('idle');

  async function save() {
    setState('saving');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: form }),
      });
      if (!res.ok) throw new Error('save failed');
      const updated: AppSettings = await res.json();
      onSaved(updated);
      setState('saved');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('error');
    }
  }

  const dirty =
    form.name !== settings.sender.name ||
    form.email !== settings.sender.email ||
    form.replyTo !== settings.sender.replyTo;

  return (
    <Panel icon={<Mail size={14} color="var(--ink-600)" />} title="Sender identity">
      <p style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        Used on every outbound email — manual sends, the daily cron, and follow-ups. Changes take effect on the next send.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Sender name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
        <Field label="Sender email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} type="email" />
        <Field label="Reply-to email" value={form.replyTo} onChange={v => setForm(f => ({ ...f, replyTo: v }))} type="email" hint="Replies are matched back to contacts via Brevo Inbound Parsing." />
      </div>
      <SaveBar dirty={dirty} state={state} onSave={save} onReset={() => setForm(settings.sender)} />
    </Panel>
  );
}

function CadencePanel({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const [form, setForm] = useState(settings.cadence);
  const [state, setState] = useState<SaveState>('idle');

  async function save() {
    setState('saving');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadence: form }),
      });
      if (!res.ok) throw new Error('save failed');
      const updated: AppSettings = await res.json();
      onSaved(updated);
      setState('saved');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('error');
    }
  }

  const dirty =
    form.followUpDays !== settings.cadence.followUpDays ||
    form.finalNudgeDays !== settings.cadence.finalNudgeDays ||
    form.coldDays !== settings.cadence.coldDays ||
    form.dailySendCap !== settings.cadence.dailySendCap;

  return (
    <Panel icon={<Clock size={14} color="var(--ink-600)" />} title="Sequence cadence">
      <p style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        How long the cron waits between automated steps. The day-X numbers count from each contact's last contact date — so a contact moves through their own timeline, not a shared one.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <NumField label="Follow-up after (days)" value={form.followUpDays} onChange={v => setForm(f => ({ ...f, followUpDays: v }))} hint="Step 1 → Step 2" />
        <NumField label="Final nudge after (days)" value={form.finalNudgeDays} onChange={v => setForm(f => ({ ...f, finalNudgeDays: v }))} hint="Step 2 → Step 3" />
        <NumField label="Auto-cold after (days)" value={form.coldDays} onChange={v => setForm(f => ({ ...f, coldDays: v }))} hint="Step 3 → cold (no email)" />
        <NumField label="Daily send cap" value={form.dailySendCap} onChange={v => setForm(f => ({ ...f, dailySendCap: v }))} hint="Max cron sends per UTC day" />
      </div>
      <SaveBar dirty={dirty} state={state} onSave={save} onReset={() => setForm(settings.cadence)} />
    </Panel>
  );
}

function HiddenListsPanel({ lists, hiddenIds, onChange }: { lists: BrevoList[]; hiddenIds: number[]; onChange: (next: number[]) => void | Promise<void> }) {
  const hiddenSet = new Set(hiddenIds);
  const hiddenLists = lists.filter(l => hiddenSet.has(l.id));

  return (
    <Panel icon={<EyeOff size={14} color="var(--ink-600)" />} title="Hidden lists">
      <p style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        Lists hidden from the dashboard's Active Towns card and the queue's filter strip. Hidden lists still receive automated follow-ups — they're just kept out of the way.
      </p>
      {hiddenLists.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--ink-400)', padding: '6px 0' }}>
          No lists are hidden. You can hide a town from the Active Towns card on the dashboard.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hiddenLists.map(l => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--paper)', border: '1px solid var(--ink-100)', borderRadius: 'var(--r-md)' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                  {typeof l.uniqueSubscribers === 'number' && (
                    <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>{l.uniqueSubscribers} contacts</div>
                  )}
                </div>
                <button
                  onClick={() => onChange(hiddenIds.filter(id => id !== l.id))}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11.5, fontWeight: 600, background: 'transparent', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)', color: 'var(--ink-700)', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <Eye size={11} /> Unhide
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <button
              onClick={() => onChange([])}
              className="btn-ghost"
              style={{ fontSize: 12 }}
            >
              Unhide all
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

function Field({ label, value, onChange, type = 'text', hint }: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-500)', fontWeight: 600 }}>
      <span style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '8px 10px',
          fontSize: 13,
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-sm)',
          fontFamily: 'inherit',
          color: 'var(--ink-900)',
          background: 'var(--white)',
        }}
      />
      {hint && <span style={{ fontSize: 10.5, color: 'var(--ink-400)', fontWeight: 500 }}>{hint}</span>}
    </label>
  );
}

function NumField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-500)', fontWeight: 600 }}>
      <span style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
      <input
        type="number"
        min={0}
        max={365}
        value={value}
        onChange={e => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
        style={{
          padding: '8px 10px',
          fontSize: 13,
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-sm)',
          fontFamily: 'inherit',
          color: 'var(--ink-900)',
          background: 'var(--white)',
        }}
      />
      {hint && <span style={{ fontSize: 10.5, color: 'var(--ink-400)', fontWeight: 500 }}>{hint}</span>}
    </label>
  );
}

function SaveBar({ dirty, state, onSave, onReset }: { dirty: boolean; state: SaveState; onSave: () => void; onReset: () => void }) {
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--ink-100)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <button
        onClick={onSave}
        disabled={!dirty || state === 'saving'}
        className="btn-primary"
        style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: dirty ? 1 : 0.5 }}
      >
        {state === 'saving' ? 'Saving…' : state === 'saved' ? (<><Check size={12} /> Saved</>) : state === 'error' ? (<><AlertCircle size={12} /> Retry</>) : 'Save changes'}
      </button>
      {dirty && state === 'idle' && (
        <button onClick={onReset} className="btn-ghost" style={{ fontSize: 12 }}>Reset</button>
      )}
    </div>
  );
}
