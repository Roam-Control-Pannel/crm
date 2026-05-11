/**
 * SOCIAL-SETTINGS-V1
 *
 * Shared types for social settings (posting times + theme overrides).
 * No runtime deps so client code can import these without dragging
 * @netlify/blobs into the client bundle.
 *
 * Same drift-prevention pattern as lib/notification-types.ts.
 */

import type { Theme } from './social-themes';

// ============================================================
// Posting times
// ============================================================

/**
 * A single posting slot for one platform. The cron uses these to know
 * which time slots are valid to schedule auto-generated posts in.
 *
 * day: 0=Sun, 1=Mon, ..., 6=Sat (matches JS Date.getDay())
 * time: 'HH:MM' 24-hour
 */
export interface PostingTimeSlot {
  day: number;     // 0..6
  time: string;    // 'HH:MM'
}

/**
 * Per-platform posting time config. Keys are platform strings matching
 * SocialAccount.platform values: 'linkedin', 'facebook', 'instagram'.
 */
export interface PostingTimes {
  linkedin: PostingTimeSlot[];
  facebook: PostingTimeSlot[];
  instagram: PostingTimeSlot[];
  // CRON-AUTOGEN-V1: how many days ahead the auto-generate cron fills.
  // Optional — falls back to DEFAULT_LOOKAHEAD_DAYS when undefined.
  lookaheadDays?: number;
}

// ============================================================
// Theme overrides
// ============================================================

/**
 * User-edited state layered on top of the seed themes from
 * lib/social-themes.ts. The cron and settings UI merge seed + overrides
 * at read time to produce the effective theme list.
 *
 * - enabled: per-id enabled overrides (true = force on, false = force off)
 *   If a seed theme's id isn't in this map, the seed's own enabled flag wins.
 * - edits: partial-Theme overrides applied per id. Each field present in
 *   the partial overrides the seed value.
 * - additions: user-added themes that don't exist in the seed.
 * - deletions: seed theme ids the user has soft-deleted. Deleted themes
 *   are filtered out of the effective list. Can be undone by removing
 *   from this array.
 */
export interface ThemeOverrides {
  enabled: Record<string, boolean>;
  edits: Record<string, Partial<Theme>>;
  additions: Theme[];
  deletions: string[];
}

// ============================================================
// Combined settings blob
// ============================================================

/**
 * What gets stored in Netlify Blobs under key 'social-settings'.
 * Versioned so future schema changes don't break old data.
 */
export interface SocialSettingsBlob {
  version: 1;
  postingTimes: PostingTimes;
  themeOverrides: ThemeOverrides;
  updatedAt: string;     // ISO timestamp
}

/**
 * The shape returned by GET /api/social/settings — settings merged
 * with seed data to produce ready-to-use lists.
 */
export interface EffectiveSocialSettings {
  postingTimes: PostingTimes;
  themes: Theme[];          // seed + overrides applied + deletions filtered
  // CRON-AUTOGEN-V1: resolved lookahead (always defined here)
  lookaheadDays: number;
}

// ============================================================
// Defaults
// ============================================================

/**
 * Default posting times — sensible-best-practice slots per platform.
 * The user can edit these via the settings UI; defaults apply only
 * when no override blob exists.
 *
 * Day numbers: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 */
export const DEFAULT_POSTING_TIMES: PostingTimes = {
  // LinkedIn: B2B-leaning, morning + lunch on weekdays
  linkedin: [
    { day: 2, time: '08:00' }, { day: 2, time: '12:00' },  // Tue
    { day: 3, time: '08:00' }, { day: 3, time: '12:00' },  // Wed
    { day: 4, time: '08:00' }, { day: 4, time: '12:00' },  // Thu
  ],
  // Facebook: broader audience, midday + Sunday morning
  facebook: [
    { day: 3, time: '13:00' },  // Wed
    { day: 5, time: '13:00' },  // Fri
    { day: 0, time: '10:00' },  // Sun
  ],
  // Instagram: visual, daily evening + late morning
  instagram: [
    { day: 0, time: '11:00' }, { day: 0, time: '19:00' },
    { day: 1, time: '11:00' }, { day: 1, time: '19:00' },
    { day: 2, time: '11:00' }, { day: 2, time: '19:00' },
    { day: 3, time: '11:00' }, { day: 3, time: '19:00' },
    { day: 4, time: '11:00' }, { day: 4, time: '19:00' },
    { day: 5, time: '11:00' }, { day: 5, time: '19:00' },
    { day: 6, time: '11:00' }, { day: 6, time: '19:00' },
  ],
};

/**
 * An empty overrides block. Used when the override blob doesn't exist
 * yet (first run) or when the user resets to defaults.
 */
export const EMPTY_OVERRIDES: ThemeOverrides = {
  enabled: {},
  edits: {},
  additions: [],
  deletions: [],
};

// CRON-AUTOGEN-V1: default days-ahead window for the auto-generate cron.
export const DEFAULT_LOOKAHEAD_DAYS = 14;
