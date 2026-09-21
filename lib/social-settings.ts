import { getStore } from '@netlify/blobs';
import { DEFAULT_IMAGE_COOLDOWN_DAYS } from './image-usage';
import { DEFAULT_CAPTION_MODEL, isKnownCaptionModel } from './ai-models';
import { readStored } from './store-read';
import { SEED_THEMES, type Theme } from './social-themes';
import {
  DEFAULT_POSTING_TIMES,
  EMPTY_OVERRIDES,
  EMPTY_BRIEF_WEIGHTS,
  type SocialSettingsBlob,
  type PostingTimes,
  type ThemeOverrides,
  type BriefWeights,
  type EffectiveSocialSettings,
  DEFAULT_LOOKAHEAD_DAYS,
} from './social-settings-types';

/**
 * SOCIAL-SETTINGS-V1
 *
 * Server-side persistence + merge for social settings.
 *
 * Storage shape (Netlify Blobs):
 *   store: 'roam-system'  (same store as notifications, different key)
 *   key:   'social-settings'
 *   value: SocialSettingsBlob (versioned JSON)
 *
 * Merge logic at read time:
 *   1. Start with SEED_THEMES from lib/social-themes.ts
 *   2. Filter out themes whose id is in overrides.deletions
 *   3. For each remaining theme, apply overrides.edits[id] as a shallow merge
 *   4. Apply overrides.enabled[id] if present (overrides the seed's enabled)
 *   5. Append overrides.additions (user-added themes)
 *   6. Sort alphabetically within each category for stable display order
 *
 * Posting times: simpler. If a posting-times blob exists, use it.
 * Otherwise fall back to DEFAULT_POSTING_TIMES.
 *
 * Single-user mode for now; multi-user would scope the key per user.
 */

const STORE_NAME = 'roam-system';
const KEY = 'social-settings';

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

// ============================================================
// Raw blob read/write
// ============================================================

/**
 * Read the raw blob. Returns null if nothing's been saved yet.
 *
 * FAIL-CLOSED-READS-V1: throws on a read failure. The settings route merges
 * the incoming patch onto whatever this returns and writes the result back,
 * so null-on-failure meant a single unlucky save replaced the posting times,
 * theme overrides and brief weights with just the section being edited.
 */
export async function readSettingsBlob(): Promise<SocialSettingsBlob | null> {
  return readStored<SocialSettingsBlob>('the social settings', () =>
    store().get(KEY, { type: 'json' })
  );
}

/**
 * Write the full blob. Overwrites whatever's there.
 */
export async function writeSettingsBlob(blob: SocialSettingsBlob): Promise<boolean> {
  try {
    await store().setJSON(KEY, blob as any);
    return true;
  } catch (err) {
    console.error('[social-settings] writeSettingsBlob failed:', err);
    return false;
  }
}

/**
 * Delete the blob (reset to defaults).
 */
export async function deleteSettingsBlob(): Promise<boolean> {
  try {
    await store().delete(KEY);
    return true;
  } catch (err) {
    console.error('[social-settings] deleteSettingsBlob failed:', err);
    return false;
  }
}

// ============================================================
// Merge logic — seed + overrides -> effective settings
// ============================================================

/**
 * Apply overrides to the seed themes to produce the effective theme list.
 *
 * Visible to the cron, the settings UI, and any future analytics code.
 */
export function mergeThemes(overrides: ThemeOverrides): Theme[] {
  const deletions = new Set(overrides.deletions);

  // 1. Filter deletions
  // 2. Apply edits + enabled override per seed theme
  const seedMerged: Theme[] = SEED_THEMES
    .filter(t => !deletions.has(t.id))
    .map(t => {
      const edit = overrides.edits[t.id];
      const enabledOverride = overrides.enabled[t.id];
      const merged: Theme = edit ? { ...t, ...edit } : { ...t };
      if (typeof enabledOverride === 'boolean') {
        merged.enabled = enabledOverride;
      }
      return merged;
    });

  // 3. Append additions
  const all: Theme[] = [...seedMerged, ...overrides.additions];

  // 4. Sort alphabetically within category for stable display order
  all.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.title.localeCompare(b.title);
  });

  return all;
}

/**
 * Get the effective social settings — merged seed + overrides + defaults.
 * This is what GET /api/social/settings returns and what the cron should
 * read from at scheduling time.
 */
// CRON-AUTOGEN-V1: lookaheadDays now part of the effective settings object.
// MULTI-BRIEF-V1: briefWeights also part of effective settings.
export async function getEffectiveSettings(): Promise<EffectiveSocialSettings> {
  const blob = await readSettingsBlob();
  const postingTimes: PostingTimes = blob?.postingTimes || DEFAULT_POSTING_TIMES;
  const overrides: ThemeOverrides = blob?.themeOverrides || EMPTY_OVERRIDES;
  const briefWeights: BriefWeights = blob?.briefWeights || EMPTY_BRIEF_WEIGHTS;
  return {
    postingTimes,
    themes: mergeThemes(overrides),
    lookaheadDays: blob?.postingTimes?.lookaheadDays || DEFAULT_LOOKAHEAD_DAYS,
    briefWeights,
    imageCooldownDays:
      blob?.postingTimes?.imageCooldownDays ?? DEFAULT_IMAGE_COOLDOWN_DAYS,
    // AI-MODELS-V1: never hand an unrecognised id to the caption path.
    captionModel: isKnownCaptionModel(blob?.captionModel)
      ? blob!.captionModel!
      : DEFAULT_CAPTION_MODEL,
    // IMAGE-SEMANTIC-V1: on unless explicitly turned off. `?? true` rather
    // than `|| true` so a stored `false` survives the read.
    semanticImageMatch: blob?.semanticImageMatch ?? true,
  };
}

/**
 * Convenience for the cron / future code: just the enabled themes that
 * match a given brief, post-merge.
 */
export async function getEffectiveThemesForBrief(briefId: string): Promise<Theme[]> {
  const { themes } = await getEffectiveSettings();
  return themes.filter(t => t.enabled && t.briefIds.includes(briefId));
}
