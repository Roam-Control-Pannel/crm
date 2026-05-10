'use client';
import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Bell, X, Mail, XCircle, Plus, List, Check, AlertTriangle, Sparkles, Info, Flame, Clock, Snowflake, MousePointerClick, Send, FileEdit, CalendarClock } from 'lucide-react';

/**
 * Persistent notification centre.
 *
 * Notifications now live server-side in Netlify Blobs (see lib/notifications.ts).
 * They survive reloads and can be created by webhook handlers as well as
 * client-side actions.
 *
 * Polling: we re-fetch every 30s while the panel is open to surface new
 * webhook-triggered notifications (e.g. a contact just clicked your link).
 * When the panel is closed we poll less aggressively (every 60s) just to
 * keep the unread badge fresh.
 */

// SOCIAL-NOTIFS-V1: types imported from lib/notification-types (single
// source of truth, used by both server lib/notifications.ts and this file).
import type { NotificationType, Notification } from '@/lib/notification-types';
export type { NotificationType, Notification };

/**
 * Convenience wrapper used by other client components to fire off a
 * notification. Posts to the API; gracefully no-ops if the call fails.
 */
export async function addNotification(input: {
  type: NotificationType;
  title: string;
  body?: string;
  contactEmail?: string;
  href?: string;
  dedupeKey?: string;
}): Promise<void> {
  try {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (err) {
    console.error('addNotification failed:', err);
  }
}

const typeColor: Record<string, string> = {
  email_sent: '#2f7a4f', email_failed: '#b53939', contact_imported: '#2a5fa4',
  list_created: '#9b2752', listed: '#2f7a4f', overdue: '#c47a1a',
  enriched: '#2f7a4f', info: '#7d6e70',
  hot_lead: '#b53939', engagement: '#2f7a4f', bounce: '#b53939',
  unsubscribe: '#7d6e70', stuck: '#c47a1a', going_cold: '#7d6e70',
  // SOCIAL-NOTIFS-V1
  social_published: '#2f7a4f', social_publish_failed: '#b53939',
  social_drafted: '#7d6e70', social_scheduled: '#2a5fa4',
};

function TypeIcon({ type }: { type: string }) {
  const color = typeColor[type] || '#7d6e70';
  const size = 14;
  if (type === 'email_sent') return <Mail size={size} color={color} />;
  if (type === 'email_failed') return <XCircle size={size} color={color} />;
  if (type === 'contact_imported') return <Plus size={size} color={color} />;
  if (type === 'list_created') return <List size={size} color={color} />;
  if (type === 'listed') return <Check size={size} color={color} />;
  if (type === 'overdue') return <AlertTriangle size={size} color={color} />;
  if (type === 'enriched') return <Sparkles size={size} color={color} />;
  if (type === 'hot_lead') return <Flame size={size} color={color} />;
  if (type === 'engagement') return <MousePointerClick size={size} color={color} />;
  if (type === 'bounce' || type === 'unsubscribe') return <XCircle size={size} color={color} />;
  if (type === 'stuck') return <Clock size={size} color={color} />;
  if (type === 'going_cold') return <Snowflake size={size} color={color} />;
  // SOCIAL-NOTIFS-V1
  if (type === 'social_published') return <Send size={size} color={color} />;
  if (type === 'social_publish_failed') return <XCircle size={size} color={color} />;
  if (type === 'social_drafted') return <FileEdit size={size} color={color} />;
  if (type === 'social_scheduled') return <CalendarClock size={size} color={color} />;
  return <Info size={size} color={color} />;
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export default function NotificationCentre() {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setNotifs(data.notifications || []);
      setUnread(data.unread || 0);
    } catch (err) {
      console.error('Notification refresh failed:', err);
    }
  }, []);

  useEffect(() => { setMounted(true); refresh(); }, [refresh]);

  // Poll faster when panel open, slower when closed.
  useEffect(() => {
    const interval = setInterval(refresh, open ? 30_000 : 60_000);
    return () => clearInterval(interval);
  }, [refresh, open]);

  async function markAllRead() {
    try {
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: 'all' }),
      });
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
      setUnread(0);
    } catch (err) {
      console.error('markAllRead failed:', err);
    }
  }

  async function handleClick(n: Notification) {
    // Mark this one read on click; navigate if it has a deep link.
    if (!n.read) {
      try {
        await fetch('/api/notifications', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [n.id] }),
        });
        setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
        setUnread(c => Math.max(0, c - 1));
      } catch {}
    }
    if (n.href) {
      window.location.href = n.href;
    }
  }

  const panel = mounted && open ? ReactDOM.createPortal(
    <>
      <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(26,13,18,0.6)', zIndex: 99998 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(360px, 100vw)',
        background: 'var(--white)',
        boxShadow: '-4px 0 24px rgba(26,18,19,0.2)',
        zIndex: 99999,
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--ink-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-900)' }}>Notifications</div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>{notifs.length} total · {unread} unread</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {unread > 0 && <button onClick={markAllRead} style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)', background: 'none', border: 'none', cursor: 'pointer' }}>Mark all read</button>}
            <button onClick={() => setOpen(false)} style={{ width: 28, height: 28, borderRadius: 'var(--r-xs)', border: '1.5px solid var(--ink-200)', background: 'var(--white)', cursor: 'pointer', color: 'var(--ink-500)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={14} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {notifs.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, opacity: 0.25 }}><Bell size={40} color="var(--ink-400)" /></div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-700)', marginBottom: 8 }}>All caught up</div>
              <div style={{ fontSize: 12, color: 'var(--ink-400)', lineHeight: 1.6 }}>You'll see notifications here when contacts engage, when leads turn hot, and when action is needed.</div>
            </div>
          ) : notifs.map(n => (
            <div
              key={n.id}
              onClick={() => handleClick(n)}
              style={{
                display: 'flex', gap: 12, padding: '14px 20px',
                borderBottom: '1px solid var(--ink-100)',
                background: n.read ? 'var(--white)' : '#fbeaef',
                cursor: n.href ? 'pointer' : 'default',
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: n.read ? 'var(--ink-100)' : '#f4d8df', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <TypeIcon type={n.type} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)', marginBottom: 2 }}>{n.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)', lineHeight: 1.4 }}>{n.body}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-300)', marginTop: 4, fontWeight: 500 }}>{timeAgo(n.time)}</div>
              </div>
              {!n.read && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#d03050', flexShrink: 0, marginTop: 4 }} />}
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body
  ) : null;

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 32, height: 32, borderRadius: 'var(--r-sm)',
          background: open ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.7)', position: 'relative', transition: 'all 0.15s',
          flexShrink: 0,
        }}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, background: '#d03050', color: 'white', fontSize: 9, fontWeight: 700, width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {panel}
    </>
  );
}
