import { getStore } from '@netlify/blobs';

/**
 * Persistent notification store.
 *
 * Notifications previously lived in a module-level array — they vanished on
 * page reload and couldn't be added by server-side code (e.g. the Brevo
 * webhook handler). This stores them in Netlify Blobs so:
 *   - They survive reloads and serverless cold starts
 *   - The webhook handler can write notifications when interesting events
 *     fire (hot lead clicked, hard bounce, etc.)
 *   - The notification bell can show real engagement context, not just
 *     same-session user actions
 *
 * Single-user mode for now; multi-user will scope these per user.
 */

// SOCIAL-NOTIFS-V1: types live in lib/notification-types.ts so client code
// can import them without pulling @netlify/blobs into the client bundle.
export type { NotificationType, Notification } from './notification-types';
import type { Notification } from './notification-types';

const STORE_NAME = 'roam-system';
const KEY = 'notifications';
const HISTORY_LIMIT = 100;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

export async function listNotifications(): Promise<Notification[]> {
  try {
    const data = (await store().get(KEY, { type: 'json' })) as Notification[] | null;
    return data || [];
  } catch (err) {
    console.error('listNotifications failed:', err);
    return [];
  }
}

export async function addNotification(
  input: Omit<Notification, 'id' | 'time' | 'read'>
): Promise<Notification | null> {
  const current = await listNotifications();

  // De-dupe: if same key fired within the window, skip silently. Stops
  // the cron and webhooks from spamming on repeat triggers.
  if (input.dedupeKey) {
    const cutoff = Date.now() - DEDUPE_WINDOW_MS;
    const recent = current.find(n =>
      n.dedupeKey === input.dedupeKey && new Date(n.time).getTime() >= cutoff
    );
    if (recent) return null;
  }

  const notif: Notification = {
    ...input,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    read: false,
  };
  const next = [notif, ...current].slice(0, HISTORY_LIMIT);
  try {
    await store().setJSON(KEY, next as any);
    return notif;
  } catch (err) {
    console.error('addNotification failed:', err);
    return null;
  }
}

export async function markRead(ids: string[] | 'all'): Promise<void> {
  const current = await listNotifications();
  const next = current.map(n =>
    (ids === 'all' || ids.includes(n.id)) ? { ...n, read: true } : n
  );
  try {
    await store().setJSON(KEY, next as any);
  } catch (err) {
    console.error('markRead failed:', err);
  }
}

export async function unreadCount(): Promise<number> {
  const all = await listNotifications();
  return all.filter(n => !n.read).length;
}
