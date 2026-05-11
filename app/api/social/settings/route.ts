import { NextRequest, NextResponse } from 'next/server';
import {

// CRON-AUTOGEN-V1: postingTimes can now contain an optional `lookaheadDays`
// number alongside the three platform arrays. The validation below only
// inspects the three platform keys, so lookaheadDays passes through unchanged.
  readSettingsBlob,
  writeSettingsBlob,
  deleteSettingsBlob,
  getEffectiveSettings,
} from '@/lib/social-settings';
import {
  DEFAULT_POSTING_TIMES,
  EMPTY_OVERRIDES,
  type SocialSettingsBlob,
  type PostingTimes,
  type ThemeOverrides,
} from '@/lib/social-settings-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * SOCIAL-SETTINGS-V1
 *
 * Read/write API for social settings (posting times + theme overrides).
 *
 *   GET /api/social/settings
 *     -> { ok: true, settings: EffectiveSocialSettings }
 *     Returns merged seed + overrides + defaults (the cron-ready view).
 *
 *   PUT /api/social/settings
 *     body: { postingTimes?: PostingTimes, themeOverrides?: ThemeOverrides }
 *     -> { ok: true, settings: EffectiveSocialSettings }
 *     Either field may be omitted; missing fields keep their existing values.
 *
 *   DELETE /api/social/settings
 *     -> { ok: true }
 *     Wipes the blob — next GET returns defaults + seed.
 *
 * Auth: this endpoint is NOT in the public allow-list, so it sits behind
 * the NextAuth middleware. UI calls it from logged-in pages only.
 */

export async function GET() {
  try {
    const settings = await getEffectiveSettings();
    return NextResponse.json({ ok: true, settings });
  } catch (err: any) {
    console.error('[social-settings] GET failed:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to read social settings' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const incomingTimes: PostingTimes | undefined = body.postingTimes;
    const incomingOverrides: ThemeOverrides | undefined = body.themeOverrides;

    if (!incomingTimes && !incomingOverrides) {
      return NextResponse.json(
        { error: 'Provide postingTimes and/or themeOverrides in body' },
        { status: 400 }
      );
    }

    // Read the existing blob so we can do partial updates — e.g. saving
    // just times shouldn't wipe overrides.
    const existing = await readSettingsBlob();

    const next: SocialSettingsBlob = {
      version: 1,
      postingTimes: incomingTimes || existing?.postingTimes || DEFAULT_POSTING_TIMES,
      themeOverrides: incomingOverrides || existing?.themeOverrides || EMPTY_OVERRIDES,
      updatedAt: new Date().toISOString(),
    };

    // Light validation — don't block on shape issues but log them.
    if (incomingTimes) {
      for (const platform of ['linkedin', 'facebook', 'instagram'] as const) {
        const slots = (incomingTimes as any)[platform];
        if (slots && !Array.isArray(slots)) {
          return NextResponse.json(
            { error: `postingTimes.${platform} must be an array` },
            { status: 400 }
          );
        }
      }
    }

    const ok = await writeSettingsBlob(next);
    if (!ok) {
      return NextResponse.json(
        { error: 'Failed to write settings blob' },
        { status: 500 }
      );
    }

    const settings = await getEffectiveSettings();
    return NextResponse.json({ ok: true, settings });
  } catch (err: any) {
    console.error('[social-settings] PUT failed:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to save social settings' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const ok = await deleteSettingsBlob();
    if (!ok) {
      return NextResponse.json(
        { error: 'Failed to delete settings blob' },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[social-settings] DELETE failed:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to reset social settings' },
      { status: 500 }
    );
  }
}
