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
 *        - IMAGE-FIRST: pick image — Brain (brief-led tag + folder match) ->
 *          Unsplash
 *        - build caption via /api/ai/chat with brief + theme context, AND
 *          (for Brain images) the photo's description/tags/folder-location so
 *          the copy is written about the chosen image and names the real place
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
  // Brain folder name (e.g. "Manchester"). Human-curated location/topic label
  // — more reliable than the vision auto-tags. Used as a weighted match signal
  // and surfaced to the copywriter so captions can name the real place.
  folder?: string;
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

/** Lowercase, split on non-alphanumerics, drop short noise words. */
function keywordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 3);
}

/** Count how many of an item's tags overlap (substring either way) with the
 *  given keyword list. Each tag counts at most once. */
function tagOverlap(tags: string[], words: string[]): number {
  let score = 0;
  for (const tag of tags) {
    for (const w of words) {
      if (tag.includes(w) || w.includes(tag)) {
        score += 1;
        break; // each tag counts once
      }
    }
  }
  return score;
}

/**
 * IMAGE-FIRST: pick a Brain image for a slot, ranked BRIEF-LED with the theme
 * as a tiebreak. The point is that "Fill calendar" chooses a photo relevant to
 * the account/brief first, and the caption is written about that photo
 * afterwards (see generateCaption's `image` arg).
 *
 * Scoring: each item gets a brief-overlap score (tags vs the brief's
 * name/audience/content brief) and a theme-overlap score (tags vs theme
 * title/prompt). Items are ranked by brief score first, then theme score —
 * so the photo fits the account, with the theme refining to the post angle.
 * An item is eligible if it has ANY relevance (brief OR theme), so we still
 * match when a brief's vocabulary is sparse.
 *
 * Returns the top match, or null if no Brain item overlaps at all. Keeps the
 * matching simple (substring tag overlap); future versions can use embeddings.
 */
export function pickBrainImage(
  brainItems: BrainItemLite[],
  theme: Theme,
  excludeUrls?: Set<string>,
  brief?: Brief
): BrainItemLite | null {
  if (brainItems.length === 0) return null;

  const themeWords = keywordsOf(theme.title + ' ' + theme.prompt);
  const briefWords = brief
    ? keywordsOf([brief.name, brief.audience, brief.contentBrief].filter(Boolean).join(' '))
    : [];

  if (themeWords.length === 0 && briefWords.length === 0) return null;

  // The folder name (e.g. "Manchester") is a human-curated label, more
  // reliable than the vision auto-tags — so a folder match counts double.
  const FOLDER_WEIGHT = 2;

  type Scored = { item: BrainItemLite; briefScore: number; themeScore: number };
  const scored: Scored[] = brainItems.map(item => {
    const tags = (item.tags || []).map(t => t.toLowerCase());
    const folderWords = item.folder ? keywordsOf(item.folder) : [];
    return {
      item,
      briefScore: tagOverlap(tags, briefWords) + FOLDER_WEIGHT * tagOverlap(folderWords, briefWords),
      themeScore: tagOverlap(tags, themeWords) + FOLDER_WEIGHT * tagOverlap(folderWords, themeWords),
    };
  });

  // Eligible = any relevance to the account/brief OR the theme. Rank brief-led
  // (account fit), then by theme (post angle).
  const matches = scored
    .filter(s => s.briefScore > 0 || s.themeScore > 0)
    .sort((a, b) => (b.briefScore - a.briefScore) || (b.themeScore - a.themeScore));
  if (matches.length === 0) return null;

  // Prefer images not already used in this run so a month of posts doesn't
  // reuse the single top-scoring image. Pick randomly within the strongest
  // eligible tier (same brief AND theme score) — keeps relevance high while
  // adding variety.
  const unused = matches.filter(s => !excludeUrls?.has(s.item.url));
  const eligible = unused.length > 0 ? unused : matches;
  const top = eligible[0];
  const topTier = eligible.filter(s => s.briefScore === top.briefScore && s.themeScore === top.themeScore);
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

// Per-caption timeout. A single AI generation is ~10-15s; capping it keeps
// one slow call from pushing a batch past the platform's ~26s synchronous
// function limit (see runAutoGenerate's budget note).
const CAPTION_TIMEOUT_MS = 13000;

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
  scheduledFor?: string,
  // IMAGE-FIRST: the photo already chosen for this slot. When present, the
  // copy is written ABOUT this image (its description, tags, and curated
  // folder location) rather than as generic theme copy. Omitted for the
  // Unsplash fallback, where we don't have a rich description to anchor on.
  image?: { description?: string; tags?: string[]; location?: string }
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

  // IMAGE-FIRST: when a photo has been chosen, lead with it so the copy
  // describes what is actually in the picture. The theme is demoted to an
  // angle/framing rather than the subject.
  const hasImageContext = !!(image && (image.description || (image.tags && image.tags.length) || image.location));
  const imageLines = hasImageContext
    ? [
        '',
        'IMAGE (already chosen — write the post about THIS photo):',
        image!.location ? 'Location: ' + image!.location + ' (this is where the photo is — name it naturally where it fits; do not place the post anywhere else)' : '',
        image!.description ? 'What it shows: ' + image!.description : '',
        (image!.tags && image!.tags.length) ? 'Tags: ' + image!.tags.join(', ') : '',
        'The post accompanies this image. Write copy that fits and complements what is shown — '
          + 'reference it naturally and do not describe things that are not in the photo. '
          + 'Use the THEME below as the angle/framing, not as a separate subject.',
      ].filter(Boolean)
    : [];

  const systemPrompt = [
    'You are writing a single social post.',
    '',
    'BRIEF:',
    'Name: ' + brief.name,
    'Audience: ' + brief.audience,
    'Tone: ' + tone,
    'Content brief: ' + contentBrief,
    'Hashtags (use sparingly, end of post): ' + hashtags,
    ...imageLines,
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
  // Bound each call so one slow generation can't push a batch past the
  // platform's ~26s synchronous-function limit. On timeout the fetch
  // aborts, we return '' and the caller leaves the slot for the next run.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAPTION_TIMEOUT_MS);
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
      signal: controller.signal,
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
  } finally {
    clearTimeout(timer);
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
      // Load folders too (id -> name) so each image carries its curated
      // location/topic label (e.g. "Manchester"). Best-effort — if folders
      // can't be loaded, items just have no folder and degrade to tags only.
      const folderNameById = new Map<string, string>();
      try {
        const foldersRes = await fetchJsonInternal(input.origin, '/api/brain/folders', input.internalSecret);
        for (const f of (foldersRes?.folders || [])) {
          if (f?.id && f?.name) folderNameById.set(f.id, f.name);
        }
      } catch { /* folders optional */ }

      const brainRes = await fetchJsonInternal(input.origin, '/api/brain/items', input.internalSecret);
      const rawItems: any[] = brainRes?.items || brainRes?.data || [];
      brainItems = rawItems
        .filter(i => typeof i?.mime === 'string' && i.mime.startsWith('image/') && i.blobId)
        .map(i => ({
          id: i.id,
          url: `${input.origin}/api/images/${i.blobId}`,
          credit: i.description,
          tags: i.tags,
          folder: i.folderId ? folderNameById.get(i.folderId) : undefined,
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

    // 7. Generate captions + pick images. Each caption is a real ~10-15s AI
    // call. Netlify kills a synchronous function at ~26s regardless of the
    // maxDuration we set, so we can only fit a handful per request: an
    // earlier larger budget ran past that ceiling and the route returned an
    // HTML timeout page (the "Unexpected token '<'" Fill-calendar failure).
    // Budget conservatively below the ceiling — accounting for setup time
    // already elapsed and one in-flight batch (each call capped at
    // CAPTION_TIMEOUT_MS) plus the final save — and return cleanly with
    // partial progress. The calendar dedups filled slots, so clicking Fill
    // calendar again continues where this left off.
    const TIME_BUDGET_MS = 9000;
    const CONCURRENCY = 4;
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
          // IMAGE-FIRST: choose the photo BEFORE writing any copy. Brain
          // first (brief-led match), then Unsplash. usedImageUrls steers both
          // pickers away from photos already placed in this run.
          let imageUrl: string | undefined;
          let imageCredit: string | undefined;
          let imageCreditUrl: string | undefined;
          let imagePhotoUrl: string | undefined;
          let imageUnsplashUrl: string | undefined;
          let imageSocialHandles: SocialPostDraft['imageSocialHandles'] | undefined;
          // Context passed to the copywriter so the caption is written ABOUT
          // the chosen photo. Only set for Brain images (rich description +
          // tags); the Unsplash fallback keeps theme-based copy.
          let imageForCaption: { description?: string; tags?: string[]; location?: string } | undefined;
          const brain = pickBrainImage(brainItems, spec.theme, usedImageUrls, spec.slotBrief);
          if (brain) {
            imageUrl = brain.url;
            imageCredit = brain.credit;
            imageForCaption = { description: brain.credit, tags: brain.tags, location: brain.folder };
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

          // Now write the copy — anchored to the chosen image when we have one.
          const caption = await generateCaption(
            input.origin, spec.slotBrief, spec.theme, spec.metaForCaption,
            spec.account, input.internalSecret, spec.iso,
            imageForCaption,
          );
          // generateCaption returns '' on failure (e.g. an AI rate-limit
          // under concurrency). Don't persist a body-less draft — leave the
          // slot empty so the next Fill calendar run retries it.
          if (!caption || !caption.trim()) {
            console.warn('[social-cron] empty caption — skipping slot', spec.iso);
            return null;
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
