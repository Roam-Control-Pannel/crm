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

// MULTI-BRIEF-V1: extended with briefIds + perBriefOverrides. Legacy
// briefId/flat-overrides kept for back-compat with pre-patch data.
interface AccountMetaLite {
  accountId: string;
  briefIds?: string[];
  perBriefOverrides?: Record<string, { tone?: string; hashtags?: string; contentBrief?: string }>;
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

/**
 * MULTI-BRIEF-V1: pick one brief from a list, weighted by briefWeights.
 * Briefs not in the weight map default to weight 1. If all weights are
 * zero (or list is empty), falls back to the first brief in the list.
 */
export function pickWeightedBrief(
  briefIds: string[],
  weights: Record<string, number> | undefined,
): string {
  if (briefIds.length === 0) return '';
  if (briefIds.length === 1) return briefIds[0];
  const w = briefIds.map(id => {
    const v = weights?.[id];
    return typeof v === 'number' && v > 0 ? v : 1;
  });
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return briefIds[0];
  let r = Math.random() * total;
  for (let i = 0; i < briefIds.length; i++) {
    r -= w[i];
    if (r < 0) return briefIds[i];
  }
  return briefIds[briefIds.length - 1];
}

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
  theme: Theme,
  excludeUrls?: Set<string>
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

  const matches = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  if (matches.length === 0) return null;
  // Prefer images not already used in this run so a month of posts doesn't
  // reuse the single top-scoring image. Pick randomly within the strongest
  // eligible tier — keeps relevance high while adding variety.
  const unused = matches.filter(s => !excludeUrls?.has(s.item.url));
  const eligible = unused.length > 0 ? unused : matches;
  const topScore = eligible[0].score;
  const topTier = eligible.filter(s => s.score === topScore);
  return topTier[Math.floor(Math.random() * topTier.length)].item;
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
  internalSecret: string,
  excludeUrls?: Set<string>
): Promise<{
  url: string;
  credit: string;
  creditUrl?: string;
  photoUrl?: string;
  unsplashUrl?: string;
  socialHandles?: { instagram?: string|null; twitter?: string|null; unsplash?: string|null };
} | null> {
  try {
    // The proxy route expects `query` + `count` (NOT `q`/`perPage`). The
    // earlier param mismatch meant the theme query was silently dropped,
    // Unsplash fell back to its default search, and every post in the run
    // got the SAME first image. Fetch a pool and pick a not-yet-used photo
    // so a month of posts gets visual variety even on a shared theme.
    const url = `${origin}/api/images/search?query=${encodeURIComponent(query)}&count=24`;
    const res = await fetch(url, {
      headers: { 'x-internal-call': internalSecret },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const list: any[] = data?.images || data?.results || [];
    const usable = list.filter(img => img?.url);
    if (usable.length === 0) return null;
    const unused = usable.filter(img => !excludeUrls?.has(img.url));
    const pool = unused.length > 0 ? unused : usable;
    const choice = pool[Math.floor(Math.random() * pool.length)];

    // Fire the Unsplash download-tracking ping for the chosen photo.
    // Required by their guidelines whenever a photo is "used" — which
    // includes automated selection for a draft. Fire-and-forget; ping
    // failures shouldn't block draft creation.
    if (choice.downloadLocation) {
      fetch(`${origin}/api/images/track-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-call': internalSecret },
        body: JSON.stringify({ downloadLocation: choice.downloadLocation }),
      }).catch(err => console.warn('[social-cron] Unsplash download ping failed:', err));
    }

    return {
      url: choice.url,
      credit: choice.credit || choice.attribution || '',
      creditUrl: choice.creditUrl,
      photoUrl: choice.photoUrl,
      unsplashUrl: choice.unsplashUrl,
      socialHandles: choice.socialHandles,
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
  account: RealAccountLite,
  internalSecret: string,
  scheduledFor?: string
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

  // This runs server-side with no user session, so the call to our own
  // /api/ai/chat MUST carry the internal-call secret. Without it the auth
  // middleware 307-redirects to /login and we silently get an empty string
  // back — the "auto-generated posts have no body copy" bug.
  const userMessage = scheduledFor
    ? `Write the post. It is scheduled for ${new Date(scheduledFor).toDateString()}. Make it distinct from the other posts in this series — vary the hook, angle, structure, and any examples.`
    : 'Write the post.';
  try {
    const res = await fetch(`${origin}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-call': internalSecret },
      body: JSON.stringify({
        systemPrompt,
        messages: [
          { role: 'user', content: userMessage },
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

    // 5. Brain items (optional). The /api/brain/items payload is raw stored
    // items (blobId + mime + tags, with NO url field), so the old
    // `.filter(b => b.url)` dropped every item and Brain images were never
    // used here. Build the absolute image URL ourselves — same shape the
    // social composer and /api/social/draft use. Absolute because the URL
    // is stored on the post and fetched by Meta at publish time, which
    // can't resolve a relative path. Image MIME only: text/markdown Brain
    // items aren't postable.
    let brainItems: BrainItemLite[] = [];
    try {
      const brainRes = await fetchJsonInternal(input.origin, '/api/brain/items', input.internalSecret);
      const rawItems: any[] = brainRes?.items || brainRes?.data || [];
      brainItems = rawItems
        .filter(i => typeof i?.mime === 'string' && i.mime.startsWith('image/') && i.blobId)
        .map(i => ({
          id: i.id,
          url: `${input.origin}/api/images/${i.blobId}`,
          credit: i.description,
          tags: i.tags,
        }));
    } catch {
      // Brain endpoint may not exist or be auth-restricted — degrade gracefully
      brainItems = [];
    }

    // 6. Collect every slot that needs a post. This phase is fast and
    // synchronous — dedup + brief/theme picking only, NO AI calls — so we
    // know the full workload before spending any of the time budget.
    interface SlotSpec {
      account: RealAccountLite;
      iso: string;
      slotBrief: Brief;
      theme: Theme;
      slotBriefId: string;
      metaForCaption: AccountMetaLite;
      acctResult: AutoGenerateAccountResult;
    }
    const newPosts: SocialPostDraft[] = [];
    // Track every image used in this run so the pickers can avoid handing
    // the same photo to multiple posts (the "same image all month" bug).
    const usedImageUrls = new Set<string>();
    const specs: SlotSpec[] = [];

    for (const account of realAccounts) {
      if (!account.capabilities?.canPost) continue;
      const meta = accountMetas.find(m => m.accountId === account.id);
      // MULTI-BRIEF-V1: resolve effective brief list (new shape with
      // legacy fallback). Skip account if it has no briefs assigned.
      const effectiveBriefIds: string[] = (Array.isArray(meta?.briefIds) && meta!.briefIds!.length > 0)
        ? meta!.briefIds!
        : (meta?.briefId ? [meta.briefId] : []);
      if (!meta || effectiveBriefIds.length === 0) continue;
      if (meta.active === false) continue;

      // Filter to only briefs that are active. If none active, skip account.
      const activeBriefIds = effectiveBriefIds.filter(id => {
        const b = briefs.find(x => x.id === id);
        return b && b.active;
      });
      if (activeBriefIds.length === 0) continue;

      const slots = settings.postingTimes[account.platform] || [];
      const datetimes = expandSlots(slots, now, lookaheadDays);

      const acctResult: AutoGenerateAccountResult = {
        accountId: account.id,
        // For multi-brief accounts this just shows the first assigned brief
        // — purely informational for the run report.
        briefId: activeBriefIds[0],
        created: 0,
        skipped: 0,
        themeIdsUsed: [],
      };
      if (result.details) result.details.push(acctResult);

      for (const iso of datetimes) {
        // Skip if a post already exists for this account at this time.
        const dup = existingPosts.find(p =>
          p.accountIds.includes(account.id) && p.scheduledAt === iso
        );
        if (dup) {
          acctResult.skipped += 1;
          result.skippedCount += 1;
          continue;
        }

        // MULTI-BRIEF-V1: weighted-random pick of one brief for THIS slot.
        // Weights come from settings.briefWeights; any brief missing from
        // the map defaults to weight 1 (equal).
        let slotBriefId = pickWeightedBrief(activeBriefIds, settings.briefWeights);
        let slotBrief = briefs.find(b => b.id === slotBriefId);
        let theme: Theme | null = slotBrief ? pickTheme(settings.themes, slotBriefId) : null;

        // If the picked brief has no enabled themes, try the others in
        // the account's list before giving up. Avoids the whole account
        // stalling because one of its briefs has no themes configured.
        if (!theme) {
          for (const altBriefId of activeBriefIds) {
            if (altBriefId === slotBriefId) continue;
            const altBrief = briefs.find(b => b.id === altBriefId);
            const altTheme = altBrief ? pickTheme(settings.themes, altBriefId) : null;
            if (altTheme) {
              slotBriefId = altBriefId;
              slotBrief = altBrief;
              theme = altTheme;
              break;
            }
          }
        }
        if (!slotBrief || !theme) {
          result.skippedNoThemes += 1;
          break;
        }

        // MULTI-BRIEF-V1: caption gen uses the slot's picked brief and a
        // synthesised meta where the override fields reflect that brief's
        // per-brief override (falling back to the legacy flat fields).
        const overrides = (meta!.perBriefOverrides && meta!.perBriefOverrides[slotBriefId]) || {};
        const metaForCaption: AccountMetaLite = {
          accountId: meta!.accountId,
          briefId: slotBriefId,
          toneOverride: overrides.tone || meta!.toneOverride,
          hashtagsOverride: overrides.hashtags || meta!.hashtagsOverride,
          contentBriefOverride: overrides.contentBrief || meta!.contentBriefOverride,
          active: meta!.active,
        };

        specs.push({ account, iso, slotBrief, theme, slotBriefId, metaForCaption, acctResult });
      }
    }

    // Process oldest slots first and interleave across accounts so a
    // time-bounded run spreads new posts over the whole calendar rather
    // than filling one account before starting the next.
    specs.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));

    // 7. Generate captions + pick images. Each caption is a real ~10-20s AI
    // call, so doing a fortnight of slots sequentially blew past the 60s
    // function limit — the route timed out and returned an HTML error page
    // (the "Unexpected token '<'" Fill-calendar failure). Run a bounded
    // number concurrently to maximise output, and stop once we approach the
    // budget so we always return cleanly with partial progress. The calendar
    // dedups already-filled slots, so clicking Fill calendar again continues.
    const TIME_BUDGET_MS = 30000;
    const CONCURRENCY = 5;
    let postSeq = 0;

    for (let i = 0; i < specs.length; i += CONCURRENCY) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        result.stoppedEarly = true;
        result.pendingCount = specs.length - i;
        break;
      }
      const batch = specs.slice(i, i + CONCURRENCY);
      const built = await Promise.all(batch.map(async (spec) => {
        try {
          const caption = await generateCaption(
            input.origin, spec.slotBrief, spec.theme, spec.metaForCaption,
            spec.account, input.internalSecret, spec.iso,
          );
          // generateCaption returns '' on failure (e.g. an AI rate-limit
          // under concurrency). Don't persist a body-less draft — leave the
          // slot empty so the next Fill calendar run retries it.
          if (!caption || !caption.trim()) {
            console.warn('[social-cron] empty caption — skipping slot', spec.iso);
            return null;
          }

          // Image — Brain first, then Unsplash. usedImageUrls steers both
          // pickers away from photos already placed in this run.
          let imageUrl: string | undefined;
          let imageCredit: string | undefined;
          let imageCreditUrl: string | undefined;
          let imagePhotoUrl: string | undefined;
          let imageUnsplashUrl: string | undefined;
          let imageSocialHandles: SocialPostDraft['imageSocialHandles'] | undefined;
          const brain = pickBrainImage(brainItems, spec.theme, usedImageUrls);
          if (brain) {
            imageUrl = brain.url;
            imageCredit = brain.credit;
          } else {
            const queryWords = spec.theme.title.split(' ').slice(0, 4).join(' ');
            const unsplash = await pickUnsplashImage(input.origin, queryWords, input.internalSecret, usedImageUrls);
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
            id: 'p' + Date.now().toString(36) + (postSeq++).toString(36) + Math.random().toString(36).slice(2, 6),
            briefId: spec.slotBriefId,  // MULTI-BRIEF-V1: the brief picked for THIS post
            accountIds: [spec.account.id],
            caption,
            imageUrl,
            imageCredit,
            imageCreditUrl,
            imagePhotoUrl,
            imageUnsplashUrl,
            imageSocialHandles,
            scheduledAt: spec.iso,
            status: 'draft',
            createdAt: new Date().toISOString(),
          };
          return { post, spec, imageUrl };
        } catch (err) {
          console.error('[social-cron] slot generation failed:', err);
          return null;
        }
      }));

      for (const b of built) {
        if (!b) { result.errorCount += 1; continue; }
        if (b.imageUrl) usedImageUrls.add(b.imageUrl);
        newPosts.push(b.post);
        b.spec.acctResult.created += 1;
        b.spec.acctResult.themeIdsUsed.push(b.spec.theme.id);
        result.createdCount += 1;
      }
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
