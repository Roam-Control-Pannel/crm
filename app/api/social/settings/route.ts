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
import { isKnownCaptionModel } from '@/lib/ai-models';

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
 *     body: { postingTimes?, themeOverrides?, briefWeights?, captionModel? }
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
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const incomingTimes: PostingTimes | undefined = body.postingTimes;
    const incomingOverrides: ThemeOverrides | undefined = body.themeOverrides;
    // MULTI-BRIEF-V1: optional weights map.
    const incomingWeights: Record<string, number> | undefined = body.briefWeights;
    // AI-MODELS-V1: optional caption model id.
    const incomingModel: unknown = body.captionModel;

    if (!incomingTimes && !incomingOverrides && !incomingWeights && incomingModel === undefined) {
      return NextResponse.json(
        { error: 'Provide postingTimes, themeOverrides, briefWeights, or captionModel in body' },
        { status: 400 }
      );
    }

    // Reject an unknown model outright rather than storing it. getEffectiveSettings
    // would fall back to the default on read, so a typo would silently "save"
    // and then appear to have done nothing — worse than an error.
    if (incomingModel !== undefined && !isKnownCaptionModel(incomingModel)) {
      return NextResponse.json(
        { error: 'Unknown captionModel' },
        { status: 400 }
      );
    }

    // Read the existing blob so we can do partial updates — e.g. saving
    // just times shouldn't wipe overrides.
    const existing = await readSettingsBlob();

    // MULTI-BRIEF-V1: validate weights are non-negative integers.
    let validWeights = incomingWeights;
    if (validWeights) {
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(validWeights)) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
        clean[k] = Math.round(v);
      }
      validWeights = clean;
    }

    const next: SocialSettingsBlob = {
      version: 1,
      postingTimes: incomingTimes || existing?.postingTimes || DEFAULT_POSTING_TIMES,
      themeOverrides: incomingOverrides || existing?.themeOverrides || EMPTY_OVERRIDES,
      briefWeights: validWeights || existing?.briefWeights || {},
      captionModel:
        incomingModel === undefined ? existing?.captionModel : (incomingModel as string),
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
