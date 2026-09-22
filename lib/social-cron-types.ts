/**
 * CRON-AUTOGEN-V1 — Types for the social auto-generate cron.
 *
 * Lives in its own file so server-side cron code and client-side UI can
 * both import it without dragging the server-only Blobs SDK into the
 * client bundle.
 */

export interface AutoGenerateRunResult {
  /**
   * FILL-BUDGET-V2: set when the window was too short to both rank photos
   * and write captions, so this invocation used the lexical ranking. Not an
   * error — the slots were still filled — but worth surfacing rather than
   * silently producing worse matches.
   */
  semanticSkipped?: boolean;
  /**
   * FILL-BUDGET-V2: set when the run ended without starting a single batch
   * because the setup phase used the whole window. Distinct from stopping
   * part-way, which is the normal shape of a multi-click fill.
   */
  noRoomForBatch?: boolean;
  /**
   * FILL-DIAGNOSIS-V1: when nothing was planned, which of the several very
   * different reasons it was. Only 'calendar-full' means the calendar is
   * full; the others are setup problems the reader can act on.
   */
  emptyReason?: string;
  /**
   * CAPTION-ERRORS-V1: why captions failed, when they did. Distinct reasons
   * only, first three. Empty/absent when every caption succeeded.
   */
  captionErrors?: string[];
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
  // Set when the run hit its wall-clock budget before generating every
  // pending slot (each caption is a real, slow AI call). pendingCount is how
  // many slots were left; the calendar dedups filled slots, so running again
  // continues where this left off.
  stoppedEarly?: boolean;
  pendingCount?: number;
}

export interface AutoGenerateAccountResult {
  accountId: string;
  briefId: string;
  created: number;
  skipped: number;
  themeIdsUsed: string[];     // for debugging "is the random picker doing its job"
}
