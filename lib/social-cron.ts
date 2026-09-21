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
import { pickBrainImageForContext } from '@/lib/brain-image-match';
import {
  buildImageUsage,
  isInCooldown,
  byLeastRecentlyUsed,
  DEFAULT_IMAGE_COOLDOWN_DAYS,
  type ImageUsageMap,
} from '@/lib/image-usage';
import {
  buildCaptionHistory,
  captionHistoryLines,
  EMPTY_CAPTION_HISTORY,
  type CaptionHistory,
  type CaptionSourcePost,
} from '@/lib/caption-history';
import { captionModelSpec, SHORTLIST_TIMEOUT_MS } from '@/lib/ai-models';
import { fetchSemanticRank, type SemanticRank } from '@/lib/image-shortlist';

// Mirrors the SocialPost interface defined inline in app/social/page.tsx.
// Kept in sync by convention — if that interface changes, this one must too.
// Future refactor: extract to lib/social-types.ts and import from both.
interface SocialPostDraft {
  id: string;
  briefId?: string;
  /** THEME-ROTATION-V1: which theme produced this post. Recorded so theme
   *  selection can rotate least-recently-used instead of picking at random
   *  with no memory — the same fix as image cooldown, applied to angles.
   *  Optional: posts created before this landed simply don't count towards
   *  rotation, which self-corrects within one fill. */
  themeId?: string;
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
  /**
   * IMAGE-RANK-V2: the vision model's sentence about the photo. It was
   * carried only as `credit` — a name left over from Unsplash attribution
   * that made it look like a photographer byline, which is why the matcher
   * never scored it and why it once reached the composer as "Photo by
   * Marketing advertisement showing...". Named for what it is now; `credit`
   * stays only where an actual attribution is meant.
   */
  description?: string;
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

/**
 * THEME-ROTATION-V1
 *
 * Was `eligible[Math.floor(Math.random() * eligible.length)]` — uniform random
 * WITH replacement and no memory. Across a 14-day fill (~100 posts) drawn from
 * 26 seed themes that guarantees heavy repetition: ~4 uses per theme on
 * average, and the unlucky ones land 8+ times. It is the copy-side twin of the
 * image bug.
 *
 * Now rotates least-recently-used against `themeUsage` (derived from existing
 * posts, same approach as image cooldown). Themes never used sort first, so a
 * newly-enabled theme gets picked up immediately. Ties break randomly so two
 * accounts filling the same slot don't lock to the same angle.
 */
export function pickTheme(
  themes: Theme[],
  briefId: string,
  themeUsage?: Map<string, number>
): Theme | null {
  const eligible = themes.filter(t => t.enabled && t.briefIds.includes(briefId));
  if (eligible.length === 0) return null;
  if (!themeUsage) return eligible[Math.floor(Math.random() * eligible.length)];

  // Least-recently-used first; never-used (undefined) counts as oldest.
  let best: Theme[] = [];
  let bestAt = Infinity;
  for (const t of eligible) {
    const at = themeUsage.get(t.id) ?? -1;
    if (at < bestAt) { bestAt = at; best = [t]; }
    else if (at === bestAt) { best.push(t); }
  }
  return best[Math.floor(Math.random() * best.length)];
}

/**
 * THEME-ROTATION-V1: most recent use (epoch ms) per theme id, from posts.
 */
export function buildThemeUsage(
  posts: Array<{ themeId?: string; scheduledAt?: string }>
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const p of posts) {
    if (!p.themeId) continue;
    const at = p.scheduledAt ? new Date(p.scheduledAt).getTime() : NaN;
    const when = Number.isFinite(at) ? at : 0;
    const prev = usage.get(p.themeId);
    if (prev === undefined || when > prev) usage.set(p.themeId, when);
  }
  return usage;
}

// ----------------------------------------------------------------------------
// Image picker — Brain (by tag overlap) -> Unsplash -> none
// ----------------------------------------------------------------------------

/**
 * IMAGE-FIRST: pick a Brain image for a slot, ranked BRIEF-LED with the theme
 * as a tiebreak. The point is that "Fill calendar" chooses a photo relevant to
 * the account/brief first, and the caption is written about that photo
 * afterwards (see generateCaption's `image` arg).
 *
 * Thin wrapper over the shared matcher so Fill calendar, /api/social/draft and
 * the Generate-with-AI modal all score images identically. Folder-name overlap
 * is weighted there; folders are the human-curated location label.
 *
 * Returns the top match, or null if no Brain item overlaps at all.
 */
export function pickBrainImage(
  brainItems: BrainItemLite[],
  theme: Theme,
  excludeUrls?: Set<string>,
  brief?: Brief,
  usageOpts?: {
    usage?: ImageUsageMap;
    slotTime?: number;
    cooldownDays?: number;
    /** IMAGE-SEMANTIC-V1: shortlist ordering for this theme, when available. */
    semanticRank?: Map<string, number>;
  }
): BrainItemLite | null {
  return pickBrainImageForContext(brainItems, theme.title + ' ' + theme.prompt, {
    brief,
    excludeUrls,
    ...usageOpts,
  });
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
  excludeUrls?: Set<string>,
  usageOpts?: { usage?: ImageUsageMap; slotTime?: number; cooldownDays?: number }
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

    // Shared exit: fire the Unsplash download-tracking ping (required by their
    // guidelines whenever a photo is "used", which includes automated
    // selection for a draft — fire-and-forget, a ping failure must not block
    // draft creation) and shape the attribution payload. Declared once so the
    // cooldown path below and the normal path cannot drift apart.
    const finalise = (choice: any) => {
      if (choice.downloadLocation) {
        fetch(`${origin}/api/images/track-download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-call': internalSecret },
          body: JSON.stringify({ downloadLocation: choice.downloadLocation }),
        }).catch(err => console.warn('[social-cron] Unsplash download ping failed:', err));
      }
      return {
        url: choice.url as string,
        credit: (choice.credit || choice.attribution || '') as string,
        creditUrl: choice.creditUrl as string | undefined,
        photoUrl: choice.photoUrl as string | undefined,
        unsplashUrl: choice.unsplashUrl as string | undefined,
        socialHandles: choice.socialHandles,
      };
    };
    const unused = usable.filter(img => !excludeUrls?.has(img.url));
    let pool = unused.length > 0 ? unused : usable;
    // IMAGE-COOLDOWN-V1: apply the same recency rule to Unsplash. Their CDN
    // URLs are stable, so the usage map derived from posts covers them too.
    if (usageOpts?.usage && (usageOpts.cooldownDays ?? 0) > 0) {
      const slotTime = usageOpts.slotTime ?? Date.now();
      const fresh = pool.filter(
        img => !isInCooldown(img.url, usageOpts.usage!, slotTime, usageOpts.cooldownDays!)
      );
      if (fresh.length > 0) {
        pool = fresh;
      } else {
        // All in cooldown — take the stalest rather than a random repeat.
        pool = [...pool].sort((a, b) => byLeastRecentlyUsed(a.url, b.url, usageOpts.usage!));
        return finalise(pool[0]);
      }
    }
    const choice = pool[Math.floor(Math.random() * pool.length)];
    return finalise(choice);
  } catch (err) {
    console.error('[social-cron] Unsplash fetch failed:', err);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Caption generation
// ----------------------------------------------------------------------------

/**
 * Everything the copywriter needs about what has already gone out on this
 * account, plus the model to use. Grouped into one argument because the
 * call sites (Fill calendar, /api/social/draft, the composer's Generate
 * button) all need to pass the same set and a fourth positional string
 * would be a bug waiting to happen.
 */
export interface CaptionOptions {
  /** CAPTION-VARIETY-V1: previous posts on this account. */
  history?: CaptionHistory;
  /** AI-MODELS-V1: resolved caption model id. Defaults to Sonnet. */
  model?: string;
}

/**
 * Build a system prompt that fuses the brief, the brand voice, the theme,
 * per-account overrides and what this account has already published. Then
 * call /api/ai/chat and return the generated caption.
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
  image?: { description?: string; tags?: string[]; location?: string },
  options?: CaptionOptions
): Promise<string> {
  const tone = meta.toneOverride || brief.tone;
  const contentBrief = meta.contentBriefOverride || brief.contentBrief;
  const hashtags = meta.hashtagsOverride || brief.hashtags;
  const spec = captionModelSpec(options?.model);

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

  // BRAND-VOICE-IN-CAPTIONS-V1
  // brief.brandVoice is the long-form voice guide the user writes on the
  // Briefs page — "vocabulary, phrasing dos/don'ts, taglines, and any other
  // voice rules the AI should follow". It was wired into the Roam-io chat
  // (app/hub/page.tsx) and nowhere else, so every automatically generated
  // post — the overwhelming majority of what actually gets published —
  // ignored it. It belongs here more than anywhere.
  const brandVoiceLines = brief.brandVoice && brief.brandVoice.trim()
    ? ['', 'BRAND VOICE (follow strictly — these rules outrank the generic platform guidance below):', brief.brandVoice.trim()]
    : [];

  // PROMPT-CACHE-V1
  // Split into a stable half and a per-slot half. The stable half is
  // identical for every post on this brief+account+platform across a whole
  // Fill calendar run, so it is offered to Anthropic as a cacheable prefix.
  //
  // Honest note on the payoff: a prefix is only cached once it reaches the
  // model's minimum (1,024 tokens on Sonnet 5, 512 on Opus 5 — recorded as
  // minCacheableTokens in lib/ai-models.ts). A lean brief with no brand
  // voice will not reach either, and the marker is then ignored rather than
  // rejected. It starts paying the moment a brief carries a real voice
  // guide, which is the direction this is heading. The split is worth doing
  // regardless: stable brand context first, volatile per-slot context
  // second, is simply the right shape for this prompt.
  const stablePrompt = [
    'You are writing a single social post.',
    '',
    'BRIEF:',
    'Name: ' + brief.name,
    'Audience: ' + brief.audience,
    'Tone: ' + tone,
    'Content brief: ' + contentBrief,
    'Hashtags (use sparingly, end of post): ' + hashtags,
    ...brandVoiceLines,
    '',
    'PLATFORM:',
    platformGuidance[platform] || '',
  ].join('\n');

  const variablePrompt = [
    ...imageLines,
    '',
    'THEME for this post:',
    theme.title,
    theme.prompt,
    ...captionHistoryLines(options?.history || EMPTY_CAPTION_HISTORY),
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
  // The bound is per-model: Opus writes better and slower, and the batch
  // budget in runAutoGenerate is derived from this same number so the two
  // cannot drift apart.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), spec.captionTimeoutMs);
  try {
    const res = await fetch(`${origin}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-call': internalSecret },
      body: JSON.stringify({
        // Structured system blocks: /api/ai/chat passes an array straight
        // through to Anthropic, so the cache marker survives.
        systemPrompt: [
          { type: 'text', text: stablePrompt, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: variablePrompt },
        ],
        messages: [
          { role: 'user', content: userMessage },
        ],
        maxTokens: 800,
        model: spec.id,
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

    // IMAGE-COOLDOWN-V1 / THEME-ROTATION-V1
    // Derive what's been used, and when, from the calendar itself. This is
    // the fix for the original complaint: the old per-run `usedImageUrls` Set
    // started empty on every invocation, and a full 14-day fill takes ~21 of
    // them (TIME_BUDGET_MS caps each at roughly one batch), so it never
    // excluded anything. Because this route re-reads social_posts at the top
    // of every invocation and saves its output at the end, deriving from
    // posts gives run N+1 full sight of run N — and of every previous fill.
    const imageUsage = buildImageUsage(existingPosts);
    const themeUsage = buildThemeUsage(existingPosts);
    const cooldownDays = settings.imageCooldownDays ?? DEFAULT_IMAGE_COOLDOWN_DAYS;

    // CAPTION-VARIETY-V1
    // The same trick for copy. `captionSource` starts as the calendar and
    // grows as this run writes posts, so a later batch can see what an
    // earlier one said. Within a single batch the CONCURRENCY slots share a
    // snapshot — the same deliberate limitation as the image picker, and for
    // the same reason: they are in flight simultaneously. It matters less
    // here than it looks, because specs are interleaved across accounts and
    // the history is scoped per account.
    const captionSource: CaptionSourcePost[] = existingPosts.map(p => ({
      caption: p.caption,
      accountIds: p.accountIds,
      scheduledAt: p.scheduledAt,
    }));

    // AI-MODELS-V1: one resolved spec for the whole run. Unknown ids fall
    // back to the default rather than reaching the API.
    const captionModel = captionModelSpec(settings.captionModel);

    // IMAGE-SEMANTIC-V1
    // One shortlist per (theme, brief), memoised for the whole invocation.
    // The PROMISE is cached, not the result: the four slots in a batch run
    // concurrently and would otherwise each fire the same request before any
    // of them had an answer to store.
    const rankCache = new Map<string, Promise<SemanticRank | null>>();
    function rankFor(theme: Theme, brief: Brief | undefined): Promise<SemanticRank | null> {
      if (!settings.semanticImageMatch) return Promise.resolve(null);
      const key = theme.id + '|' + (brief?.id || '');
      const hit = rankCache.get(key);
      if (hit) return hit;
      const pending = fetchSemanticRank(
        input.origin,
        brainItems,
        theme.title + ' ' + theme.prompt,
        { briefName: brief?.name, internalSecret: input.internalSecret }
      );
      rankCache.set(key, pending);
      return pending;
    }

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
          description: i.description,
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
        let theme: Theme | null = slotBrief ? pickTheme(settings.themes, slotBriefId, themeUsage) : null;

        // If the picked brief has no enabled themes, try the others in
        // the account's list before giving up. Avoids the whole account
        // stalling because one of its briefs has no themes configured.
        if (!theme) {
          for (const altBriefId of activeBriefIds) {
            if (altBriefId === slotBriefId) continue;
            const altBrief = briefs.find(b => b.id === altBriefId);
            const altTheme = altBrief ? pickTheme(settings.themes, altBriefId, themeUsage) : null;
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

        // THEME-ROTATION-V1: claim the theme for this slot straight away, so
        // the next slot in this same run rotates past it. Without this the
        // whole run would see identical usage data and pick the same theme
        // every time — the in-run twin of the cross-run amnesia.
        themeUsage.set(theme.id, new Date(iso).getTime());

        specs.push({ account, iso, slotBrief, theme, slotBriefId, metaForCaption, acctResult });
      }
    }

    // Process oldest slots first and interleave across accounts so a
    // time-bounded run spreads new posts over the whole calendar rather
    // than filling one account before starting the next.
    specs.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));

    // 7. Generate captions + pick images. Each caption is a real AI call.
    // Netlify kills a synchronous function at ~26s regardless of the
    // maxDuration we set, so we can only fit a handful per request: an
    // earlier larger budget ran past that ceiling and the route returned an
    // HTML timeout page (the "Unexpected token '<'" Fill-calendar failure).
    // Return cleanly with partial progress instead. The calendar dedups
    // filled slots, so clicking Fill calendar again continues where this
    // left off.
    //
    // The budget is DERIVED rather than tuned, because it has to hold for
    // whichever caption model is configured. The check below happens before
    // a batch starts, so the worst case is: check passes at TIME_BUDGET_MS,
    // the batch then runs for a full captionTimeoutMs, and the persist
    // follows. Solving that against the ceiling is the line below — with
    // Sonnet's 13s timeout it lands on 8.5s, near the 9s that was working
    // empirically, and with Opus's 18s it correctly tightens to 3.5s
    // (fewer slots per click, never a hard kill).
    const SYNC_CEILING_MS = 24_000;
    const PERSIST_RESERVE_MS = 2_500;
    // IMAGE-SEMANTIC-V1 adds one ranking request in front of the caption
    // request. The rankings for a batch run inside the same Promise.all, so
    // the batch grows by one ranking latency, not four — subtract it once.
    // Cost of being wrong here is a hard kill and an HTML error page, so the
    // subtraction is unconditional even though most batches reuse a cached
    // ranking and pay nothing.
    const TIME_BUDGET_MS = Math.max(
      1_000,
      SYNC_CEILING_MS - PERSIST_RESERVE_MS - captionModel.captionTimeoutMs - SHORTLIST_TIMEOUT_MS
    );
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
          // first (brief-led match), then Unsplash. Two layers keep photos
          // from repeating: `usedImageUrls` hard-excludes anything placed
          // earlier in THIS run, and `imageUsage` (derived from the calendar)
          // applies the cooldown window across runs and previous fills.
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
          const slotTime = new Date(spec.iso).getTime();
          // IMAGE-SEMANTIC-V1: ask the model which photos suit this theme
          // before scoring. Null (disabled, failed, timed out) means the
          // lexical ranking decides, exactly as it did before.
          const semanticRank = await rankFor(spec.theme, spec.slotBrief);
          const brain = pickBrainImage(
            brainItems, spec.theme, usedImageUrls, spec.slotBrief,
            { usage: imageUsage, slotTime, cooldownDays, semanticRank }
          );
          if (brain) {
            imageUrl = brain.url;
            // IMAGE-CREDIT-V1: a Brain photo is OUR asset — it has no
            // photographer to credit. `credit` previously carried the item's
            // AI-generated description, which the composer rendered as
            // "Photo by Marketing advertisement for Roam app showing...".
            // The description is still passed to the copywriter below, where
            // it belongs; it just isn't an attribution. (Published captions
            // were never affected: buildUnsplashCredit short-circuits without
            // an imageCreditUrl, which Brain images never set.)
            imageCredit = undefined;
            imageForCaption = { description: brain.credit, tags: brain.tags, location: brain.folder };
            // IMAGE-COOLDOWN-V1: reserve it NOW, inside the concurrent map.
            // The old code only did this after Promise.all resolved, so all
            // CONCURRENCY picks in a batch read the same snapshot and could
            // choose the same photo. Reserving here closes that race — Set
            // writes are synchronous and JS is single-threaded, so there is
            // no interleaving between the pick above and this line.
            usedImageUrls.add(brain.url);
          } else {
            const queryWords = spec.theme.title.split(' ').slice(0, 4).join(' ');
            const unsplash = await pickUnsplashImage(
              input.origin, queryWords, input.internalSecret, usedImageUrls,
              { usage: imageUsage, slotTime, cooldownDays }
            );
            if (unsplash) {
              usedImageUrls.add(unsplash.url);
              imageUrl = unsplash.url;
              imageCredit = unsplash.credit;
              imageCreditUrl = unsplash.creditUrl;
              imagePhotoUrl = unsplash.photoUrl;
              imageUnsplashUrl = unsplash.unsplashUrl;
              imageSocialHandles = unsplash.socialHandles;
            }
          }

          // Now write the copy — anchored to the chosen image when we have
          // one, and shown what this account has already published so it
          // varies the hook, structure and examples for real rather than
          // being told to vary them from posts it cannot see.
          const history = buildCaptionHistory(
            captionSource, spec.account.id, slotTime
          );
          const caption = await generateCaption(
            input.origin, spec.slotBrief, spec.theme, spec.metaForCaption,
            spec.account, input.internalSecret, spec.iso,
            imageForCaption,
            { history, model: captionModel.id },
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
            themeId: spec.theme.id,     // THEME-ROTATION-V1: feeds future rotation
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
        // Images are reserved at pick time now (see above), so this is
        // belt-and-braces — Set.add is idempotent. Note the deliberate
        // asymmetry: a slot whose caption failed keeps its image reserved for
        // the rest of this run. Wasting one photo is strictly better than
        // handing it to the next slot and printing a duplicate.
        if (b.imageUrl) usedImageUrls.add(b.imageUrl);
        // CAPTION-VARIETY-V1: feed this run's own output back in, so the
        // next batch sees it. Cross-invocation the re-read at step 4 covers
        // this for free; this line closes the within-invocation gap.
        captionSource.push({
          caption: b.post.caption,
          accountIds: b.post.accountIds,
          scheduledAt: b.post.scheduledAt,
        });
        newPosts.push(b.post);
        b.spec.acctResult.created += 1;
        b.spec.acctResult.themeIdsUsed.push(b.spec.theme.id);
        result.createdCount += 1;
      }
    }

    // 7. Persist
    if (newPosts.length > 0) {
      // AUTOGEN-MERGE-ON-WRITE-V1
      // `existingPosts` was read at step 5, before a long run of AI caption
      // generations. Writing [...existingPosts, ...newPosts] replaced the
      // whole collection from that stale snapshot, so any post the
      // publish-due cron published during the run (it fires every 2 minutes)
      // was restored to its pre-publish state — back to 'scheduled', with a
      // scheduledAt now in the past — and went out to the platform a second
      // time on the next tick.
      //
      // Re-read immediately before the write and merge: the fresh array is
      // the base, and we append only posts that aren't already in it.
      let base = existingPosts;
      try {
        const freshRes = await fetchJsonInternal(input.origin, '/api/store/social_posts', input.internalSecret);
        if (Array.isArray(freshRes?.data)) base = freshRes.data;
      } catch (err) {
        // A failed re-read must not silently fall back to the stale
        // snapshot — that is the exact overwrite this guard exists to
        // prevent. Abort the persist; the slots stay unfilled and the next
        // run picks them up.
        console.error('[social-cron] pre-save re-read failed, skipping persist:', err);
        throw new Error('Could not re-read social_posts before saving; aborted to avoid overwriting newer data');
      }
      const existingIds = new Set(base.map((p: SocialPostDraft) => p.id));
      const all = [...base, ...newPosts.filter(p => !existingIds.has(p.id))];
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
