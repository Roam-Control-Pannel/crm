import { getStore } from '@netlify/blobs';
import { readStored } from './store-read';

/**
 * Persistent reply storage.
 *
 * Stores inbound email replies fetched by /api/inbound/poll so the CRM UI
 * can render them on contact timelines, in dashboard attention queues, and
 * (eventually) in a unified inbox view.
 *
 * Mirrors the lib/notifications.ts pattern — same store name, key prefix
 * separates them. Blobs-backed = cross-device by default (any browser
 * signed in as Andy sees the same replies).
 *
 * Single-user mode for now; multi-user prep will scope keys per user.
 */

const STORE_NAME = 'roam-system';
const KEY_PREFIX = 'replies:';
const PER_CONTACT_LIMIT = 50;   // replies kept per contact (newest first)
const RECENT_INDEX_KEY = 'replies:_recent_index';
const RECENT_INDEX_LIMIT = 100; // global recent-replies index for the dashboard

export interface StoredReply {
  uid: number;             // IMAP UID — for dedupe across polls
  fromEmail: string;       // sender, lowercased
  fromName: string | null;
  subject: string;
  bodyText: string;        // quote-stripped clean body
  bodyTextRaw: string;     // full body with quoted history (kept for #2/#3 later)
  receivedAt: string;      // ISO timestamp from email Date header
  isAutoResponder: boolean;
  storedAt: string;        // when we wrote this
}

interface RecentIndexEntry {
  email: string;
  uid: number;
  storedAt: string;
}

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function keyFor(email: string): string {
  return `${KEY_PREFIX}${email.toLowerCase()}`;
}

/**
 * Persist a reply for a contact. Idempotent on (email, uid) — re-storing
 * the same UID is a no-op so repeat polls don't duplicate the timeline.
 */
/**
 * FAIL-CLOSED-READS-V1 + REPLY-RESULT-V1
 *
 * This used to return `null` for BOTH "we already have this UID" and "the
 * write threw", and the poll route did not assign the return value at all.
 * A Blobs 429 therefore produced: Brevo flipped to `responded`, a
 * notification fired, the Gmail message labelled processed so the next poll
 * skipped it, and `ok: true, errors: 0` in the response — while the reply
 * body itself was gone for good, leaving a contact marked as replied with an
 * empty timeline.
 *
 * The outcome is now explicit, and a failure is a failure: the caller must
 * not mark the message processed.
 */
export type StoreReplyResult =
  | { stored: true; reply: StoredReply }
  | { stored: false; reason: 'duplicate' };

export async function storeReply(
  reply: Omit<StoredReply, 'storedAt'>
): Promise<StoreReplyResult> {
  const fullReply: StoredReply = {
    ...reply,
    fromEmail: reply.fromEmail.toLowerCase(),
    storedAt: new Date().toISOString(),
  };

  // A read failure throws out of listRepliesForContact — deliberately not
  // caught. Appending to an invented empty list would drop this contact's
  // entire reply history on the write below.
  const existing = await listRepliesForContact(fullReply.fromEmail);
  // Idempotency: skip if we've already seen this UID for this contact.
  if (existing.some((r) => r.uid === fullReply.uid)) {
    return { stored: false, reason: 'duplicate' };
  }
  const next = [fullReply, ...existing].slice(0, PER_CONTACT_LIMIT);
  await store().setJSON(keyFor(fullReply.fromEmail), next as any);

  // Update the global recent index so the dashboard can find the latest
  // replies without scanning every contact.
  await updateRecentIndex({
    email: fullReply.fromEmail,
    uid: fullReply.uid,
    storedAt: fullReply.storedAt,
  });

  return { stored: true, reply: fullReply };
}

/** All stored replies for a contact, newest first. Empty array if none. */
/**
 * FAIL-CLOSED-READS-V1: throws on a read failure. storeReply() appends to
 * this and writes the result back, so an empty list on failure erased the
 * contact's whole reply timeline.
 */
export async function listRepliesForContact(email: string): Promise<StoredReply[]> {
  const data = await readStored<StoredReply[]>(`replies for ${email}`, () =>
    store().get(keyFor(email), { type: 'json' })
  );
  return data ?? [];
}

/** Most recent stored reply for a contact, or null. Cheap accessor. */
export async function mostRecentReplyForContact(email: string): Promise<StoredReply | null> {
  const all = await listRepliesForContact(email);
  return all[0] || null;
}

/**
 * Latest N replies across ALL contacts, newest first. Used by the dashboard
 * to populate the "Replied" attention queue without scanning every contact
 * blob individually.
 */
export async function recentReplies(limit = 20): Promise<StoredReply[]> {
  try {
    const index = (await store().get(RECENT_INDEX_KEY, { type: 'json' })) as RecentIndexEntry[] | null;
    if (!index || index.length === 0) return [];

    const out: StoredReply[] = [];
    // Walk index newest-first, fetch each contact's replies, pluck the matching UID.
    // Caps the work at `limit` since index is already sorted desc by storedAt.
    for (const entry of index.slice(0, limit)) {
      const replies = await listRepliesForContact(entry.email);
      const found = replies.find((r) => r.uid === entry.uid);
      if (found) out.push(found);
    }
    return out;
  } catch (err) {
    console.error('[replies] recentReplies failed:', err);
    return [];
  }
}

async function updateRecentIndex(entry: RecentIndexEntry): Promise<void> {
  try {
    const current = (await store().get(RECENT_INDEX_KEY, { type: 'json' })) as RecentIndexEntry[] | null;
    const filtered = (current || []).filter(
      (e) => !(e.email === entry.email && e.uid === entry.uid)
    );
    const next = [entry, ...filtered].slice(0, RECENT_INDEX_LIMIT);
    await store().setJSON(RECENT_INDEX_KEY, next as any);
  } catch (err) {
    console.error('[replies] updateRecentIndex failed:', err);
  }
}
