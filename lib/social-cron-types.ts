/**
 * CRON-AUTOGEN-V1 — Types for the social auto-generate cron.
 *
 * Lives in its own file so server-side cron code and client-side UI can
 * both import it without dragging the server-only Blobs SDK into the
 * client bundle.
 */

export interface AutoGenerateRunResult {
  ok: boolean;
  createdCount: number;
  skippedCount: number;       // slots that already had posts
  skippedNoThemes: number;    // accounts with brief that has no enabled themes
  errorCount: number;
  rangeStart: string;         // ISO
  rangeEnd: string;           // ISO
  durationMs: number;
  // Optional per-account breakdown for UI feedback. Trimmed by the endpoint
  // if too large to fit in a notification body.
  details?: AutoGenerateAccountResult[];
  error?: string;
}

export interface AutoGenerateAccountResult {
  accountId: string;
  briefId: string;
  created: number;
  skipped: number;
  themeIdsUsed: string[];     // for debugging "is the random picker doing its job"
}
