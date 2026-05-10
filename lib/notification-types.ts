/**
 * Single source of truth for Notification types.
 *
 * Both lib/notifications.ts (server, uses @netlify/blobs) and
 * components/NotificationCentre.tsx (client) import from here. Keeping
 * this in a runtime-dep-free file lets the client import without dragging
 * server-only modules into the bundle.
 *
 * Same drift-prevention pattern as lib/types.ts (PR #33 for AttentionContact).
 */

export type NotificationType =
  // Outreach / CRM events
  | 'email_sent'
  | 'email_failed'
  | 'contact_imported'
  | 'list_created'
  | 'listed'
  | 'overdue'
  | 'enriched'
  | 'info'
  | 'hot_lead'        // contact clicked a link
  | 'engagement'      // contact opened (only sent for first-time opens)
  | 'bounce'          // email hard-bounced
  | 'unsubscribe'     // contact unsubscribed
  | 'stuck'           // contact opened but didn't click after N days
  | 'going_cold'      // contact about to be auto-marked cold

  // Social calendar events (SOCIAL-NOTIFS-V1)
  | 'social_published'
  | 'social_publish_failed'
  | 'social_drafted'
  | 'social_scheduled';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  time: string;       // ISO timestamp
  read: boolean;
  contactEmail?: string;  // when notification relates to a specific contact
  href?: string;          // deep link to relevant page
  // De-dup key — same key within a recent window collapses into one
  // notification rather than spamming.
  dedupeKey?: string;
}
