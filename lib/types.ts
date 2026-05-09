/**
 * Shared types used across CRM API routes and UI components.
 *
 * Anything that crosses the API/UI boundary lives here. Wire-format types
 * (e.g. raw Brevo contact shapes) stay next to their callers — those aren't
 * shared, they're implementation detail of one route.
 *
 * If you find yourself declaring the same interface in two files, move it
 * here. PR #32 was caused by the previous duplication of AttentionContact;
 * don't reintroduce it.
 */

/**
 * A contact surfaced in one of the dashboard's "needs attention" queues
 * (hottest, stuck, going cold, replied). Produced by /api/pipeline,
 * consumed by app/page.tsx > AttentionCard.
 */
export interface AttentionContact {
  email: string;
  name: string;
  town: string;
  status: string;
  /** Why this contact's flagged — short human-readable label. */
  signal: string;
  /** ISO timestamp of when the signal happened. */
  signalAt: string;
  /** Days at this stage. */
  daysIn: number;
  /** First ~200 chars of the reply body, for the replied queue. */
  replyPreview?: string;
}
