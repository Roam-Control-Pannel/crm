import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
import { generateCaption, pickBrainImage, pickUnsplashImage } from '@/lib/social-cron';
import { getEffectiveSettings } from '@/lib/social-settings';
import { fetchBriefs } from '@/lib/briefs';
import { getCollection, saveCollection, DEFAULT_USER_ID } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/social/draft — create one social post draft.
 *
 * Body: {
 *   briefId: string,
 *   accountId: string,                // 'li-personal:...', 'meta-ig:...', etc.
 *   themeId?: string,                  // if absent, picked from enabled themes
 *   scheduledAt?: string,              // ISO; default = next morning 9am
 *   withImage?: 'none' | 'brain' | 'unsplash',  // default 'none'
 *   captionOverride?: string,         // if present, skip AI generation
 * }
 *
 * Auth: requires x-internal-call header with CRON_SECRET_V2, OR the
 * caller can prove they're running inside the same deployment. We use
 * the secret for now — same pattern as auto-generate.
 *
 * Responds with the saved SocialPost (same shape the social page uses).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET_V2;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET_V2 not configured' }, { status: 500 });
  }
  const provided = req.headers.get('x-internal-call');
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { briefId, accountId, themeId, scheduledAt, withImage, captionOverride } = body;
    if (!briefId || !accountId) {
      return NextResponse.json({ ok: false, error: 'briefId and accountId required' }, { status: 400 });
    }

    const origin = new URL(req.url).origin;

    // 1. Resolve brief
    const briefs = await fetchBriefs();
    const brief = briefs.find(b => b.id === briefId);
    if (!brief) {
      return NextResponse.json({ ok: false, error: `Brief ${briefId} not found` }, { status: 404 });
    }

    // 2. Resolve theme (pick random enabled if not specified)
    const { themes } = await getEffectiveSettings();
    const candidates = themes.filter(t => t.enabled && t.briefIds.includes(briefId));
    let theme = themeId ? candidates.find(t => t.id === themeId) : candidates[Math.floor(Math.random() * candidates.length)];
    if (!theme && candidates.length > 0) theme = candidates[0];
    if (!theme) {
      return NextResponse.json({ ok: false, error: `No enabled themes for brief ${briefId}` }, { status: 400 });
    }

    // 3. Resolve account + meta from internal endpoints
    const accountsRes = await fetch(`${origin}/api/accounts/status`, { headers: { 'x-internal-call': secret } });
    const accountsData = accountsRes.ok ? await accountsRes.json() : null;
    // Route returns realAccounts, not accounts — patch-6 launch bug fixed in 6.1.
    const allAccounts: any[] = accountsData?.realAccounts || [];
    const account = allAccounts.find((a: any) => a.id === accountId);
    if (!account) {
      // Include the available ids in the error so any future key-name
      // mismatch is debuggable from the Roam-io chat response itself.
      const availableIds = allAccounts.map((a: any) => a.id).slice(0, 10);
      return NextResponse.json({
        ok: false,
        error: `Account ${accountId} not found. Available: ${availableIds.join(', ') || '(none returned)'}`,
      }, { status: 404 });
    }
    const metaCol = (await getCollection<any[]>(DEFAULT_USER_ID, 'account_meta')) || [];
    const meta = metaCol.find((m: any) => m.accountId === accountId) || { accountId, briefId };

    // 4. Generate caption (unless override provided)
    let caption = captionOverride;
    if (!caption) {
      caption = await generateCaption(origin, brief, theme, meta, account);
      if (!caption) {
        return NextResponse.json({ ok: false, error: 'Caption generation failed' }, { status: 502 });
      }
    }

    // 5. Optional image
    let imageUrl: string | undefined;
    let imageCredit: string | undefined;
    let imageCreditUrl: string | undefined;
    let imagePhotoUrl: string | undefined;
    let imageUnsplashUrl: string | undefined;
    let imageSocialHandles: any;

    if (withImage === 'brain') {
      const brainItems = (await getCollection<any[]>(DEFAULT_USER_ID, 'briefs')) ? [] : []; // brain items live in a different store
      // Brain images come from the brain items store, not the user collection.
      try {
        const brainStore = getStore('roam-brain');
        const items = ((await brainStore.get('items', { type: 'json' })) as any[]) || [];
        const liteItems = items
          .filter(i => i.mime?.startsWith('image/'))
          .map(i => ({ id: i.id, url: `/api/images/${i.blobId}`, credit: i.description, tags: i.tags }));
        const picked = pickBrainImage(liteItems, theme);
        if (picked) {
          imageUrl = picked.url;
          imageCredit = picked.credit;
        }
      } catch (err) {
        console.error('[social/draft] Brain image pick failed:', err);
      }
    } else if (withImage === 'unsplash') {
      const query = `${theme.title} ${brief.name}`.slice(0, 80);
      const picked = await pickUnsplashImage(origin, query, secret);
      if (picked) {
        imageUrl = picked.url;
        imageCredit = picked.credit;
        imageCreditUrl = picked.creditUrl;
        imagePhotoUrl = picked.photoUrl;
        imageUnsplashUrl = picked.unsplashUrl;
        imageSocialHandles = picked.socialHandles;
      }
    }

    // 6. Compute scheduledAt (default: tomorrow 9am)
    let when = scheduledAt;
    if (!when) {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      t.setHours(9, 0, 0, 0);
      when = t.toISOString();
    }

    // 7. Build + persist the draft
    const post = {
      id: 'post_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      briefId,
      accountIds: [accountId],
      caption,
      imageUrl,
      imageCredit,
      imageCreditUrl,
      imagePhotoUrl,
      imageUnsplashUrl,
      imageSocialHandles,
      scheduledAt: when,
      status: 'draft' as const,
      town: undefined,
      createdAt: new Date().toISOString(),
    };

    const existing = (await getCollection<any[]>(DEFAULT_USER_ID, 'social_posts')) || [];
    await saveCollection(DEFAULT_USER_ID, 'social_posts', [post, ...existing]);

    return NextResponse.json({ ok: true, post });
  } catch (err: any) {
    console.error('[social/draft] error:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Failed' }, { status: 500 });
  }
}
