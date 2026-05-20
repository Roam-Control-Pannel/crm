'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { BrevoListSelector } from '@/components/BrevoListSelector';
import { Mail, Pause, Play, MapPin, Check, Snowflake, MessageSquare, AlertCircle } from 'lucide-react';

interface Contact {
  id: number;
  email: string;
  attributes: Record<string, string>;
  listIds?: number[];
}

type SendState = 'idle' | 'sending' | 'done' | 'error';

/**
 * Cadence the cron enforces, mirrored here so we can show "next send in Xd"
 * on each in-flight card. Keep these in sync with /api/sequences/route.ts —
 * the source of truth is the cron, this is just for display.
 */
const STEP_DELAYS = {
  email_sent: 2,    // -> followed_up (step 2 email)
  followed_up: 7,   // -> final_nudge (step 3 email)
  final_nudge: 14,  // -> cold (no email, status flip)
} as const;

const COLUMN_DEFS = [
  { key: 'not_contacted', label: 'Not contacted', accent: '#9e7e88', status: ['not_contacted'] },
  { key: 'email_sent',    label: 'Step 1 sent',   accent: '#b06820', status: ['email_sent'] },
  { key: 'followed_up',   label: 'Step 2 sent',   accent: '#1a6b9a', status: ['followed_up'] },
  { key: 'final_nudge',   label: 'Step 3 sent',   accent: '#6a3d8c', status: ['final_nudge'] },
  { key: 'done',          label: 'Done',          accent: '#2f7a4f', status: ['listed', 'cold', 'responded'] },
] as const;

// Pleasant palette for town pills. Hashing the town string into this gives
// each town a stable colour across reloads without needing to persist a map.
const TOWN_PALETTE = [
  { bg: '#fff0e6', fg: '#b06820' },
  { bg: '#e8f1f8', fg: '#1a6b9a' },
  { bg: '#f1e8f5', fg: '#6a3d8c' },
  { bg: '#fde9e9', fg: '#b53939' },
  { bg: '#e8f4ec', fg: '#2f7a4f' },
  { bg: '#fff4e0', fg: '#c47a1a' },
  { bg: '#eef2fb', fg: '#2a5fa4' },
  { bg: '#f5ecef', fg: '#8B1A3A' },
];

function townColor(town: string) {
  if (!town) return TOWN_PALETTE[0];
  let h = 0;
  for (let i = 0; i < town.length; i++) h = (h * 31 + town.charCodeAt(i)) | 0;
  return TOWN_PALETTE[Math.abs(h) % TOWN_PALETTE.length];
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function nextSendCountdown(status: string, lastContact?: string): { label: string; overdue: boolean } | null {
  if (!lastContact) return null;
  const delay = (STEP_DELAYS as Record<string, number>)[status];
  if (!delay) return null;
  const due = new Date(lastContact);
  due.setDate(due.getDate() + delay);
  const days = daysBetween(new Date(), due);
  if (days < 0) return { label: `${-days}d overdue`, overdue: true };
  if (days === 0) return { label: 'firing today', overdue: false };
  if (days === 1) return { label: 'fires tomorrow', overdue: false };
  return { label: `fires in ${days}d`, overdue: false };
}

function StepDots({ status }: { status: string }) {
  // Maps a status to how many steps have been sent (filled) vs pending.
  const filled =
    status === 'not_contacted' ? 0 :
    status === 'email_sent'    ? 1 :
    status === 'followed_up'   ? 2 :
    status === 'final_nudge'   ? 3 :
    status === 'listed'        ? 3 :
    status === 'cold'          ? 3 :
    status === 'responded'     ? 3 : 0;
  const colour = status === 'listed' ? '#2f7a4f' : status === 'responded' ? '#3a7a4d' : status === 'cold' ? '#7d6e70' : 'var(--maroon-600)';
  return (
    <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {[1, 2, 3].map(i => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: i <= filled ? colour : 'transparent',
            border: `1.5px solid ${i <= filled ? colour : 'var(--ink-200)'}`,
            display: 'inline-block',
          }}
        />
      ))}
    </div>
  );
}

function TownPill({ town }: { town: string }) {
  if (!town) return null;
  const c = townColor(town);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      background: c.bg,
      color: c.fg,
      fontSize: 10.5,
      fontWeight: 700,
      borderRadius: 'var(--r-pill)',
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>
      <MapPin size={9} />
      {town}
    </span>
  );
}

export default function QueuePage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const [pendingPause, setPendingPause] = useState<Set<string>>(new Set());

  const loadContacts = useCallback(async () => {
    setLoading(true);
    const url = activeListId !== null
      ? `/api/brevo/contacts?limit=500&listId=${activeListId}`
      : `/api/brevo/contacts?limit=500`;
    try {
      const d = await fetch(url, { cache: 'no-store' }).then(r => r.json());
      setContacts(d.contacts || []);
    } catch {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [activeListId]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // Bucket contacts by column. Single pass; uses our COLUMN_DEFS to keep
  // the column order and status mapping in one place.
  const columns = useMemo(() => {
    const byKey: Record<string, Contact[]> = {};
    for (const def of COLUMN_DEFS) byKey[def.key] = [];
    for (const c of contacts) {
      if (!c.email || !c.attributes?.BUSINESS_NAME) continue;
      const status = c.attributes?.OUTREACH_STATUS || 'not_contacted';
      const def = COLUMN_DEFS.find(d => (d.status as readonly string[]).includes(status));
      if (def) byKey[def.key].push(c);
    }
    return byKey;
  }, [contacts]);

  // Counts for the summary header.
  const summary = useMemo(() => {
    const inFlight = columns.email_sent.length + columns.followed_up.length + columns.final_nudge.length;
    return {
      notContacted: columns.not_contacted.length,
      inFlight,
      done: columns.done.length,
      paused: contacts.filter(c => c.attributes?.PAUSED === 'true').length,
    };
  }, [columns, contacts]);

  async function enrol(contact: Contact) {
    const key = String(contact.id);
    setSendStates(s => ({ ...s, [key]: 'sending' }));
    try {
      const res = await fetch('/api/brevo/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: contact.email,
          businessName: contact.attributes.BUSINESS_NAME,
          town: contact.attributes.TOWN || '',
          knownFor: contact.attributes.KNOWN_FOR || 'its independent spirit',
          step: 1,
        }),
      });
      if (!res.ok) throw new Error('Send failed');
      // Flip status so the cron picks up day 2 / day 7 / day 14 automatically.
      // Also clear PAUSED in case this is a re-enrolment.
      await fetch('/api/brevo/contacts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: contact.email, OUTREACH_STATUS: 'email_sent', PAUSED: 'false' }),
      });
      setSendStates(s => ({ ...s, [key]: 'done' }));
      // Refresh after a short beat so the card moves into the next column.
      setTimeout(() => { loadContacts(); }, 700);
    } catch {
      setSendStates(s => ({ ...s, [key]: 'error' }));
    }
  }

  async function togglePause(contact: Contact, paused: boolean) {
    const key = String(contact.id);
    setPendingPause(prev => { const n = new Set(prev); n.add(key); return n; });
    try {
      await fetch('/api/brevo/contacts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: contact.email, PAUSED: paused ? 'true' : 'false' }),
      });
      // Optimistic local update so the card flips immediately without a full refetch.
      setContacts(curr => curr.map(c => c.email === contact.email
        ? { ...c, attributes: { ...c.attributes, PAUSED: paused ? 'true' : 'false' } }
        : c));
    } catch (err) {
      console.error('togglePause failed:', err);
    } finally {
      setPendingPause(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  return (
    <div className="page-wrap">
      <div style={{ marginBottom: 14 }}>
        <h1 className="page-title">Today's Queue</h1>
        <p className="page-sub">
          {loading
            ? 'Loading…'
            : `${summary.notContacted} ready to enrol · ${summary.inFlight} in flight${summary.paused ? ` (${summary.paused} paused)` : ''} · ${summary.done} done`}
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <BrevoListSelector value={activeListId} onChange={setActiveListId} onSync={loadContacts} />
      </div>

      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-400)', fontSize: 13 }}>
          Loading queue from Brevo…
        </div>
      ) : (
        <div className="kanban-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))', gap: 12, alignItems: 'start' }}>
          {COLUMN_DEFS.map(def => {
            const items = columns[def.key] || [];
            return (
              <div key={def.key} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="card-header" style={{ borderLeft: `3px solid ${def.accent}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-800)' }}>{def.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-400)' }}>({items.length})</span>
                  </div>
                </div>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 80 }}>
                  {items.length === 0 ? (
                    <div style={{ padding: '20px 8px', fontSize: 11.5, color: 'var(--ink-300)', textAlign: 'center', fontStyle: 'italic' }}>
                      {def.key === 'not_contacted' ? 'Nothing to enrol — sync to pull new contacts' : '—'}
                    </div>
                  ) : (
                    items.map(c => (
                      <KanbanCard
                        key={c.id}
                        contact={c}
                        sendState={sendStates[String(c.id)] || 'idle'}
                        pausePending={pendingPause.has(String(c.id))}
                        onEnrol={() => enrol(c)}
                        onTogglePause={(paused) => togglePause(c, paused)}
                        columnKey={def.key}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media (max-width: 1100px) {
          .kanban-grid { grid-template-columns: repeat(5, minmax(220px, 1fr)) !important; overflow-x: auto; padding-bottom: 8px; }
        }
      `}</style>
    </div>
  );
}

function KanbanCard({ contact, sendState, pausePending, onEnrol, onTogglePause, columnKey }: {
  contact: Contact;
  sendState: SendState;
  pausePending: boolean;
  onEnrol: () => void;
  onTogglePause: (paused: boolean) => void;
  columnKey: string;
}) {
  const status = contact.attributes?.OUTREACH_STATUS || 'not_contacted';
  const town = contact.attributes?.TOWN || '';
  const name = contact.attributes?.BUSINESS_NAME || contact.email;
  const paused = contact.attributes?.PAUSED === 'true';
  const isInFlight = ['email_sent', 'followed_up', 'final_nudge'].includes(status);
  const countdown = isInFlight ? nextSendCountdown(status, contact.attributes?.LAST_CONTACT_DATE) : null;

  const doneBadge = (() => {
    if (status === 'listed') return { icon: <Check size={11} />, label: 'Listed', color: '#2f7a4f' };
    if (status === 'cold')   return { icon: <Snowflake size={11} />, label: 'Cold', color: '#7d6e70' };
    if (status === 'responded') return { icon: <MessageSquare size={11} />, label: 'Replied', color: '#3a7a4d' };
    return null;
  })();

  return (
    <div
      style={{
        background: paused ? 'var(--paper)' : 'var(--white)',
        border: `1px solid ${paused ? 'var(--ink-200)' : 'var(--ink-100)'}`,
        borderRadius: 'var(--r-md)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        opacity: paused ? 0.7 : sendState === 'done' ? 0.5 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1.3, overflow: 'hidden' }}>
          {name}
        </div>
        <StepDots status={status} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        <TownPill town={town} />
        {doneBadge && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 8px',
            fontSize: 10.5,
            fontWeight: 700,
            background: `${doneBadge.color}14`,
            color: doneBadge.color,
            border: `1px solid ${doneBadge.color}33`,
            borderRadius: 'var(--r-pill)',
          }}>
            {doneBadge.icon} {doneBadge.label}
          </span>
        )}
        {paused && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 8px',
            fontSize: 10.5,
            fontWeight: 700,
            background: 'var(--ink-100)',
            color: 'var(--ink-600)',
            borderRadius: 'var(--r-pill)',
          }}>
            <Pause size={9} /> Paused
          </span>
        )}
      </div>

      {countdown && !paused && (
        <div style={{ fontSize: 10.5, color: countdown.overdue ? '#b53939' : 'var(--ink-500)', fontWeight: 600 }}>
          Next send {countdown.label}
        </div>
      )}

      <div style={{ fontSize: 10.5, color: 'var(--ink-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {contact.email}
      </div>

      {columnKey === 'not_contacted' && (
        <button
          onClick={onEnrol}
          disabled={sendState !== 'idle'}
          style={{
            marginTop: 4,
            padding: '7px 10px',
            background: sendState === 'done'
              ? 'linear-gradient(135deg,#1a5c36,#2d7a4f)'
              : sendState === 'error'
                ? '#c0392b'
                : 'linear-gradient(135deg,#6B1230,#8B1A3A)',
            color: '#fff',
            fontSize: 11.5,
            fontWeight: 700,
            border: 'none',
            borderRadius: 'var(--r-sm)',
            cursor: sendState === 'idle' ? 'pointer' : 'default',
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          {sendState === 'idle' && (<><Mail size={12} /> Approve & Enrol</>)}
          {sendState === 'sending' && (<><Mail size={12} style={{ animation: 'spin 0.8s linear infinite' }} /> Sending…</>)}
          {sendState === 'done' && (<><Check size={12} /> Enrolled</>)}
          {sendState === 'error' && (<><AlertCircle size={12} /> Retry</>)}
        </button>
      )}

      {isInFlight && (
        <button
          onClick={() => onTogglePause(!paused)}
          disabled={pausePending}
          style={{
            marginTop: 4,
            padding: '6px 10px',
            background: 'transparent',
            color: 'var(--ink-600)',
            fontSize: 11,
            fontWeight: 600,
            border: '1px solid var(--ink-200)',
            borderRadius: 'var(--r-sm)',
            cursor: pausePending ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          {paused ? (<><Play size={11} /> Resume</>) : (<><Pause size={11} /> Pause sequence</>)}
        </button>
      )}
    </div>
  );
}
