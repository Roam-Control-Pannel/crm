import { getStore } from '@netlify/blobs';

/**
 * Workspace-level settings persisted in Netlify Blobs.
 *
 * Storage:
 *   store: 'roam-system' (same store as other workspace settings)
 *   key:   'app-settings'
 *   value: AppSettings (versioned JSON, partial merges supported)
 *
 * Read at:
 *   - /api/brevo/send         (sender identity for outbound)
 *   - /api/sequences          (cadence + daily send cap for the cron)
 *   - /app/settings           (the UI surface for editing)
 *
 * Defaults below mirror the previously-hardcoded values so an empty blob
 * preserves existing behaviour. Partial updates from the UI deep-merge
 * into the current blob — the UI only sends the section it edited.
 */

export interface SenderSettings {
  name: string;
  email: string;
  replyTo: string;
}

export interface CadenceSettings {
  /** Days between step 1 (email_sent) and step 2 (followed_up). */
  followUpDays: number;
  /** Days between step 2 (followed_up) and step 3 (final_nudge). */
  finalNudgeDays: number;
  /** Days between step 3 (final_nudge) and auto-cold. */
  coldDays: number;
  /** Max emails the cron may send per UTC day across all sequences. */
  dailySendCap: number;
}

export interface AppSettings {
  sender: SenderSettings;
  cadence: CadenceSettings;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  sender: {
    name: 'Roam Local Team',
    email: 'hello@roam-everywhere.com',
    replyTo: 'replies@roam-everywhere.com',
  },
  cadence: {
    followUpDays: 2,
    finalNudgeDays: 7,
    coldDays: 14,
    dailySendCap: 50,
  },
};

const STORE_NAME = 'roam-system';
const KEY = 'app-settings';

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

export async function getAppSettings(): Promise<AppSettings> {
  try {
    const data = (await store().get(KEY, { type: 'json' })) as Partial<AppSettings> | null;
    return mergeWithDefaults(data);
  } catch (err) {
    console.error('[app-settings] read failed:', err);
    return DEFAULT_APP_SETTINGS;
  }
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getAppSettings();
  const merged: AppSettings = {
    sender: { ...current.sender, ...(patch.sender || {}) },
    cadence: { ...current.cadence, ...(patch.cadence || {}) },
  };
  // Validate numbers stay positive integers — bad values would brick the cron.
  for (const k of ['followUpDays', 'finalNudgeDays', 'coldDays', 'dailySendCap'] as const) {
    const v = merged.cadence[k];
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      merged.cadence[k] = DEFAULT_APP_SETTINGS.cadence[k];
    }
  }
  try {
    await store().setJSON(KEY, merged as any);
  } catch (err) {
    console.error('[app-settings] write failed:', err);
  }
  return merged;
}

function mergeWithDefaults(partial: Partial<AppSettings> | null): AppSettings {
  if (!partial) return DEFAULT_APP_SETTINGS;
  return {
    sender: { ...DEFAULT_APP_SETTINGS.sender, ...(partial.sender || {}) },
    cadence: { ...DEFAULT_APP_SETTINGS.cadence, ...(partial.cadence || {}) },
  };
}
