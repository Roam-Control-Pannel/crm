/**
 * CRON-AUTOGEN-V1 — Social calendar auto-generation engine.
 *
 * Pure logic — the route file in app/api/social/auto-generate/route.ts is the
 * thin shell that calls this and persists the resulting posts. Splitting it
 * out keeps the route file small and lets us unit-test the picker/slot logic
 * later without standing up a route handler.
 *
 * Flow per run:
 *   1. Load effective settings (posting times + lookahead + themes)
 *   2. Load real accounts + account_meta from internal endpoints
 *   3. Load briefs (per-user collection)
 *   4. Load existing social_posts (to skip slots that already have one)
 *   5. For each (account with briefId) x (slot in the next N days):
 *        - skip if a draft/scheduled already exists for that account+time
 *        - pick a random enabled theme matching the account's brief
 *        - build caption via /api/ai/chat (with brief + theme context)
 *        - pick image: Brain by tag overlap -> Unsplash -> none
 *        - construct SocialPost { status: "draft", scheduledAt, ... }
 *   6. Append all new posts to social_posts via internal save
 *   7. Fire one de-duped social_drafted notification
 */

import type { Brief } from '@/lib/briefs';
import type { Theme } from '@/lib/social-themes';
import type { PostingTimeSlot } from '@/lib/social-settings-types';
import type { AutoGenerateRunResult, AutoGenerateAccountResult } from '@/lib/social-cron-types';
import { getEffectiveSettings } from '@/lib/social-settings';
import { DEFAULT_LOOKAHEAD_DAYS } from '@/lib/social-settings-types';
import { addNotification } from '@/lib/notifications';

// Mirrors the SocialPost interface defined inline in app/social/page.tsx.
// Kept in sync by convention — if that interface changes, this one must too.
// Future refactor: extract to lib/social-types.ts and import from both.
interface SocialPostDraft {
  id: string;
  briefId?: string;
  accountIds: string[];
  caption: string;
  imageUrl?: string;
  imageCredit?: string;
  // Unsplash attribution fields, carried through to publish time where
  // the caption-credit suffix is built from them.
  imageCreditUrl?: string;
  imagePhotoUrl?: string;
  imageUnsplashUrl?: string;
  imageSocialHandles?: { instagram?: string|null; twitter?: string|null; unsplash?: string|null };
  scheduledAt: string;
  status: 'draft';
  town?: string;
  createdAt: string;
}

interface RealAccountLite {
  id: string;
  platform: 'linkedin' | 'facebook' | 'instagram';
  type: 'personal' | 'company' | 'page';
  handle: string;
  region?: string;
  capabilities: { canPost: boolean };
}

interface AccountMetaLite {
  accountId: string;
  briefId?: string;
  toneOverride?: string;
  hashtagsOverride?: string;
  contentBriefOverride?: string;
  active?: boolean;
}

interface BrainItemLite {
  id: string;
  url: string;
  credit?: string;
  tags?: string[];
}

// ----------------------------------------------------------------------------
// Slot computation
// ----------------------------------------------------------------------------

/**
 * Expand a list of weekly recurring slots into concrete datetimes covering
 * `lookaheadDays` from `from`. Returns ISO strings in chronological order.
 *
 * Slots are interpreted in the server's local timezone (= the user's expected
 * posting time). For a UK-focused product served from Netlify (UTC), this is
 * a slight skew that we ignore for v1 — the user can tweak posting times if
 * they need them shifted.
 */
export function expandSlots(
  slots: PostingTimeSlot[],
  from: Date,
  lookaheadDays: number
): string[] {
  const out: string[] = [];
  const start = new Date(from);
  start.setSeconds(0, 0);

  for (let dayOffset = 0; dayOffset < lookaheadDays; dayOffset++) {
    const d = new Date(start);
    d.setDate(d.getDate() + dayOffset);
    const dow = d.getDay(); // 0..6, Sun-Sat
    for (const slot of slots) {
      if (slot.day !== dow) continue;
      const [hh, mm] = slot.time.split(':').map(n => parseInt(n, 10));
      const dt = new Date(d);
      dt.setHours(hh, mm, 0, 0);
      // Don't generate slots in the past
      if (dt.getTime() <= from.getTime()) continue;
      out.push(dt.toISOString());
    }
  }
  out.sort();
  return out;
}

// ----------------------------------------------------------------------------
// Theme picker — random from enabled themes for this brief
// ----------------------------------------------------------------------------

export function pickTheme(themes: Theme[], briefId: string): Theme | null {
  const eligible = themes.filter(t => t.enabled && t.briefIds.includes(briefId));
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

// ----------------------------------------------------------------------------
// Image picker — Brain (by tag overlap) -> Unsplash -> none
// ----------------------------------------------------------------------------

/**
 * Score Brain items by tag overlap with theme prompt keywords + theme id.
 * Returns the top match, or null if no Brain item has any overlap.
 *
 * Keeps the matching simple: lowercase substring of theme prompt words
 * against tags. Future versions can use embeddings.
 */
export function pickBrainImage(
  brainItems: BrainItemLite[],
  theme: Theme
): BrainItemLite | null {
  if (brainItems.length === 0) return null;

  const promptWords = (theme.title + ' ' + theme.prompt)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 3);

  if (promptWords.length === 0) return null;

  type Scored = { item: BrainItemLite; score: number };
  const scored: Scored[] = brainItems.map(item => {
    const tags = (item.tags || []).map(t => t.toLowerCase());
    let score = 0;
    for (const tag of tags) {
      for (const w of promptWords) {
        if (tag.includes(w) || w.includes(tag)) {
          score += 1;
          break; // each tag counts once
        }
      }
    }
    return { item, score };
  });

  const best = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score)[0];
  return best ? best.item : null;
}

/**
 * Search Unsplash via the existing /api/images/search proxy and (when an
 * image is selected) ping the Unsplash download-tracking endpoint. Both
 * are compliance requirements for keeping production Unsplash access.
 *
 * Returns the full attribution payload — photographer name, profile URL
 * with UTM, photo URL, social handles — which the caller stores on the
 * draft post so the credit can be appended to the caption at publish
 * time (Unsplash requires crediting in the post text itself, not just
 * inside the CRM UI).
 */
export async function pickUnsplashImage(
  origin: string,
  query: string,
  internalSecret: string
): Promise<{
  url: string;
  credit: string;
  creditUrl?: string;
  photoUrl?: string;
  unsplashUrl?: string;
  socialHandles?: { instagram?: string|null; twitter?: string|null; unsplash?: string|null };
} | null> {
  try {
    const url = `${origin}/api/images/search?q=${encodeURIComponent(query)}&perPage=1`;
    const res = await fetch(url, {
      headers: { 'x-internal-call': internalSecret },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const first = data?.results?.[0] || data?.images?.[0];
    if (!first || !first.url) return null;

    // Fire the Unsplash download-tracking ping for this photo. Required
    // by their guidelines whenever a photo is "used" — which includes
    // automated selection for a draft. Fire-and-forget; ping failures
    // shouldn't block draft creation.
    if (first.downloadLocation) {
      fetch(`${origin}/api/images/track-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-call': internalSecret },
        body: JSON.stringify({ downloadLocation: first.downloadLocation }),
      }).catch(err => console.warn('[social-cron] Unsplash download ping failed:', err));
    }

    return {
      url: first.url,
      credit: first.credit || first.attribution || '',
      creditUrl: first.creditUrl,
      photoUrl: first.photoUrl,
      unsplashUrl: first.unsplashUrl,
      socialHandles: first.socialHandles,
    };
  } catch (err) {
    console.error('[social-cron] Unsplash fetch failed:', err);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Caption generation
// ----------------------------------------------------------------------------

/**
 * Build a system prompt that fuses the brief, the theme, and per-account
 * overrides. Then call /api/ai/chat and return the generated caption.
 *
 * Returns empty string on failure — the slot still gets a post with an
 * empty caption so the user can spot it and fill it in manually. Better
 * than silent skip.
 */
export async function generateCaption(
  origin: string,
  brief: Brief,
  theme: Theme,
  meta: AccountMetaLite,
  account: RealAccountLite
): Promise<string> {
  const tone = meta.toneOverride || brief.tone;
  const contentBrief = meta.contentBriefOverride || brief.contentBrief;
  const hashtags = meta.hashtagsOverride || brief.hashtags;

  const platform = account.platform;
  const platformGuidance: Record<string, string> = {
    linkedin: 'LinkedIn post. 150-300 words. Professional but warm. Use line breaks for readability. End with an open question or call to action.',
    facebook: 'Facebook post. 80-150 words. Conversational. Approachable. One or two emojis if appropriate.',
    instagram: 'Instagram caption. 60-150 words. Visual-first context. Hook in the first line. Hashtags at the end.',
  };

  const systemPrompt = [
    'You are writing a single social post.',
    '',
    'BRIEF:',
    'Name: ' + brief.name,
    'Audience: ' + brief.audience,
    'Tone: ' + tone,
    'Content brief: ' + contentBrief,
    'Hashtags (use sparingly, end of post): ' + hashtags,
    '',
    'THEME for this post:',
    theme.title,
    theme.prompt,
    '',
    'PLATFORM:',
    platformGuidance[platform] || '',
    '',
    'Output ONLY the post text. No preamble, no explanations, no "Here is your post:". The output is published verbatim.',
  ].join('\n');

  try {
    const res = await fetch(`${origin}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt,
        messages: [
          { role: 'user', content: 'Write the post.' },
        ],
        maxTokens: 800,
      }),
    });
    if (!res.ok) {
      console.error('[social-cron] AI chat failed:', res.status);
      return '';
    }
    const data: any = await res.json();
    return (data?.content || '').trim();
  } catch (err) {
    console.error('[social-cron] AI chat threw:', err);
    return '';
  }
}

// ----------------------------------------------------------------------------
// Main runner
// ----------------------------------------------------------------------------

/**
 * Headers for internal calls. The route handler passes through the same
 * x-internal-call secret pattern used by sequences/run-now.
 */
function internalHeaders(secret: string): HeadersInit {
  return { 'x-internal-call': secret };
}

async function fetchJsonInternal(
  origin: string,
  path: string,
  secret: string
): Promise<any> {
  const res = await fetch(`${origin}${path}`, {
    headers: internalHeaders(secret),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Internal fetch ${path} failed: ${res.status}`);
  }
  return res.json();
}

export interface RunInput {
  origin: string;
  internalSecret: string;
  // Override for "fill calendar" button when user wants a one-shot extend
  lookaheadDaysOverride?: number;
}

export async function runAutoGenerate(input: RunInput): Promise<AutoGenerateRunResult> {
  const startedAt = Date.now();
  const now = new Date();
  const result: AutoGenerateRunResult = {
    ok: false,
    createdCount: 0,
    skippedCount: 0,
    skippedNoThemes: 0,
    errorCount: 0,
    rangeStart: now.toISOString(),
    rangeEnd: '',
    durationMs: 0,
    details: [],
  };

  try {
    // 1. Settings
    const settings = await getEffectiveSettings();
    const lookaheadDays = input.lookaheadDaysOverride
      || settings.lookaheadDays
      || DEFAULT_LOOKAHEAD_DAYS;

    const rangeEnd = new Date(now);
    rangeEnd.setDate(rangeEnd.getDate() + lookaheadDays);
    result.rangeEnd = rangeEnd.toISOString();

    // 2. Accounts + meta — read from internal endpoints to avoid coupling
    //    to client-store helpers that aren't safe server-side.
    const accountsJson = await fetchJsonInternal(input.origin, '/api/accounts/status', input.internalSecret);
    const realAccounts: RealAccountLite[] = accountsJson?.realAccounts || [];

    const metaRes = await fetchJsonInternal(input.origin, '/api/store/account_meta', input.internalSecret);
    const accountMetas: AccountMetaLite[] = metaRes?.data || [];

    // 3. Briefs
    const briefsRes = await fetchJsonInternal(input.origin, '/api/store/briefs', input.internalSecret);
    const briefs: Brief[] = briefsRes?.data || [];

    // 4. Existing posts
    const postsRes = await fetchJsonInternal(input.origin, '/api/store/social_posts', input.internalSecret);
    const existingPosts: SocialPostDraft[] = postsRes?.data || [];

    // 5. Brain items (optional)
    let brainItems: BrainItemLite[] = [];
    try {
      const brainRes = await fetchJsonInternal(input.origin, '/api/brain/items', input.internalSecret);
      brainItems = (brainRes?.items || brainRes?.data || []).filter((b: any) => b.url);
    } catch {
      // Brain endpoint may not exist or be auth-restricted — degrade gracefully
      brainItems = [];
    }

    // 6. Per account, walk slots and generate
    const newPosts: SocialPostDraft[] = [];

    for (const account of realAccounts) {
      if (!account.capabilities?.canPost) continue;
      const meta = accountMetas.find(m => m.accountId === account.id);
      if (!meta || !meta.briefId) continue;
      if (meta.active === false) continue;

      const brief = briefs.find(b => b.id === meta.briefId);
      if (!brief || !brief.active) continue;

      const slots = settings.postingTimes[account.platform] || [];
      const datetimes = expandSlots(slots, now, lookaheadDays);

      const acctResult: AutoGenerateAccountResult = {
        accountId: account.id,
        briefId: meta.briefId,
        created: 0,
        skipped: 0,
        themeIdsUsed: [],
      };

      for (const iso of datetimes) {
        // Skip if a post already exists for this account at this time
        const dup = existingPosts.find(p =>
          p.accountIds.includes(account.id) && p.scheduledAt === iso
        ) || newPosts.find(p =>
          p.accountIds.includes(account.id) && p.scheduledAt === iso
        );
        if (dup) {
          acctResult.skipped += 1;
          result.skippedCount += 1;
          continue;
        }

        const theme = pickTheme(settings.themes, meta.briefId);
        if (!theme) {
          // No enabled theme for this brief — skip the rest of this account
          result.skippedNoThemes += 1;
          break;
        }
        acctResult.themeIdsUsed.push(theme.id);

        // Caption
        const caption = await generateCaption(input.origin, brief, theme, meta, account);

        // Image — Brain first, then Unsplash
        let imageUrl: string | undefined;
        let imageCredit: string | undefined;
        let imageCreditUrl: string | undefined;
        let imagePhotoUrl: string | undefined;
        let imageUnsplashUrl: string | undefined;
        let imageSocialHandles: SocialPostDraft['imageSocialHandles'] | undefined;
        const brain = pickBrainImage(brainItems, theme);
        if (brain) {
          imageUrl = brain.url;
          imageCredit = brain.credit;
        } else {
          const queryWords = theme.title.split(' ').slice(0, 4).join(' ');
          const unsplash = await pickUnsplashImage(input.origin, queryWords, input.internalSecret);
          if (unsplash) {
            imageUrl = unsplash.url;
            imageCredit = unsplash.credit;
            imageCreditUrl = unsplash.creditUrl;
            imagePhotoUrl = unsplash.photoUrl;
            imageUnsplashUrl = unsplash.unsplashUrl;
            imageSocialHandles = unsplash.socialHandles;
          }
        }

        const post: SocialPostDraft = {
          id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          briefId: meta.briefId,
          accountIds: [account.id],
          caption,
          imageUrl,
          imageCredit,
          imageCreditUrl,
          imagePhotoUrl,
          imageUnsplashUrl,
          imageSocialHandles,
          scheduledAt: iso,
          status: 'draft',
          createdAt: new Date().toISOString(),
        };
        newPosts.push(post);
        acctResult.created += 1;
        result.createdCount += 1;
      }

      if (result.details) result.details.push(acctResult);
    }

    // 7. Persist
    if (newPosts.length > 0) {
      const all = [...existingPosts, ...newPosts];
      const saveRes = await fetch(`${input.origin}/api/store/social_posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...internalHeaders(input.internalSecret),
        },
        body: JSON.stringify({ data: all }),
      });
      if (!saveRes.ok) {
        throw new Error(`Save failed: ${saveRes.status}`);
      }
    }

    // 8. Notification (de-duped within 24h)
    if (result.createdCount > 0) {
      await addNotification({
        type: 'social_drafted',
        title: 'Auto-generated drafts',
        body: `Created ${result.createdCount} draft${result.createdCount === 1 ? '' : 's'} `
          + `across ${result.details?.length || 0} account${(result.details?.length || 0) === 1 ? '' : 's'}.`,
        href: '/social',
        dedupeKey: 'social-autogen-' + new Date().toISOString().slice(0, 10),
      });
    }

    result.ok = true;
  } catch (err: any) {
    console.error('[social-cron] runAutoGenerate failed:', err);
    result.error = err?.message || 'Unknown error';
    result.errorCount = 1;
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}
