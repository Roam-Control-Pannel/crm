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
import { getCollection, saveCollection, DEFAULT_USER_ID } from '@/lib/store';
import { getItems as getBrainItems, getFolders as getBrainFolders } from '@/lib/brain-store';
import {
  DEFAULT_LOOKAHEAD_DAYS,
  type EffectiveSocialSettings,
} from '@/lib/social-settings-types';
import { runOutcomeNotification } from '@/lib/autogen-notify';
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
import {
  brainFingerprint,
  readShortlists,
  writeShortlists,
  type ShortlistCache,
} from '@/lib/shortlist-cache';

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
 * Build the system prompt that fuses the brief, the brand voice, the theme,
 * per-account overrides and what this account has already published, and
 * return it as a transport-free request.
 */
/**
 * FILL-BATCH-V1
 *
 * The request a caption generation makes, with no transport attached.
 *
 * Split out of generateCaption so the synchronous path (POST /api/ai/chat,
 * one slot at a time) and the batched path (one Messages Batch for a whole
 * fill) build byte-identical prompts. Two copies of this prompt would drift
 * within a release, and the divergence would be invisible: both would still
 * produce captions, just differently good ones.
 */
export interface CaptionRequest {
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  messages: Array<{ role: 'user'; content: string }>;
  maxTokens: number;
  model: string;
  /** Per-model abort bound. Only the synchronous path uses it. */
  timeoutMs: number;
}

export function buildCaptionRequest(
  brief: Brief,
  theme: Theme,
  meta: AccountMetaLite,
  account: RealAccountLite,
  scheduledFor?: string,
  // IMAGE-FIRST: the photo already chosen for this slot. When present, the
  // copy is written ABOUT this image (its description, tags, and curated
  // folder location) rather than as generic theme copy. Omitted for the
  // Unsplash fallback, where we don't have a rich description to anchor on.
  image?: { description?: string; tags?: string[]; location?: string },
  options?: CaptionOptions
): CaptionRequest {
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

  const userMessage = scheduledFor
    ? `Write the post. It is scheduled for ${new Date(scheduledFor).toDateString()}. Make it distinct from the other posts in this series — vary the hook, angle, structure, and any examples.`
    : 'Write the post.';

  return {
    // Structured system blocks: the stable half carries the cache marker,
    // and /api/ai/chat passes the array straight through to Anthropic.
    system: [
      { type: 'text', text: stablePrompt, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: variablePrompt },
    ],
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 800,
    model: spec.id,
    timeoutMs: spec.captionTimeoutMs,
  };
}

/**
 * CAPTION-ERRORS-V1
 *
 * The outcome of one caption attempt, with the reason when there isn't one.
 *
 * This used to be a bare string, empty on any failure, with the cause going
 * only to console.error. A run where every caption failed therefore reported
 * "generation stalled — try again in a few minutes" and nothing else, which
 * is a guess dressed as advice: waiting fixes a rate limit and does nothing
 * at all for a bad model id, a missing key or an auth redirect, and there was
 * no way to tell which had happened without server logs.
 */
export interface CaptionOutcome {
  text: string;
  /** Human-readable cause, present exactly when text is empty. */
  error?: string;
}

/**
 * Build a caption request and run it through /api/ai/chat.
 */
export async function generateCaption(
  origin: string,
  brief: Brief,
  theme: Theme,
  meta: AccountMetaLite,
  account: RealAccountLite,
  internalSecret: string,
  scheduledFor?: string,
  image?: { description?: string; tags?: string[]; location?: string },
  options?: CaptionOptions
): Promise<CaptionOutcome> {
  const req = buildCaptionRequest(brief, theme, meta, account, scheduledFor, image, options);

  // This runs server-side with no user session, so the call to our own
  // /api/ai/chat MUST carry the internal-call secret. Without it the auth
  // middleware 307-redirects to /login and we silently get an empty string
  // back — the "auto-generated posts have no body copy" bug.
  //
  // Bound each call so one slow generation can't push a batch past the
  // platform's ~26s synchronous-function limit. On timeout the fetch
  // aborts and the caller leaves the slot for the next run.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    const res = await fetch(`${origin}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-call': internalSecret },
      body: JSON.stringify({
        systemPrompt: req.system,
        messages: req.messages,
        maxTokens: req.maxTokens,
        model: req.model,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // CAPTION-ERRORS-V1: read the body. The upstream message is the whole
      // difference between "rate limited, wait a minute" and "that model id
      // is not available on this key", and the old code discarded it.
      const raw = await res.text().catch(() => '');
      let detail = '';
      try { detail = JSON.parse(raw)?.error || ''; } catch { detail = raw.slice(0, 200); }
      const error = `HTTP ${res.status}${detail ? ': ' + detail : ''}`;
      console.error('[social-cron] AI chat failed:', error);
      return { text: '', error };
    }
    const data: any = await res.json();
    const text = (data?.content || '').trim();
    // A 200 with nothing in it is its own failure, and a distinct one: the
    // request was accepted and the model still produced no post. ANTHROPIC-
    // CONTENT-V1: /api/ai/chat now sends the API's own account of why it was
    // empty (stop_reason, block types, output tokens), so prefer that over
    // the generic line — "empty response" told us nothing across ten slots.
    if (text) return { text };
    const why = typeof data?.error === 'string' && data.error
      ? data.error
      : 'the model returned an empty response';
    return { text: '', error: why };
  } catch (err: any) {
    const error = err?.name === 'AbortError'
      ? `timed out after ${Math.round(req.timeoutMs / 1000)}s`
      : (err?.message || 'network error');
    console.error('[social-cron] AI chat threw:', error);
    return { text: '', error };
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

/**
 * FILL-PLAN-V1
 *
 * Everything a fill needs before any AI call is made: the settings, the
 * accounts and briefs, the calendar as it stands, the Brain, and the list of
 * slots that still want a post.
 *
 * Extracted from runAutoGenerate so the synchronous fill and the batched
 * fill (lib/fill-job.ts) plan identically. The phase is deliberately cheap
 * and side-effect free — dedup, brief and theme selection only — which is
 * what makes it safe to run twice and what lets a batch job know its whole
 * workload up front instead of discovering it a request at a time.
 */
export interface SlotSpec {
  account: RealAccountLite;
  iso: string;
  slotBrief: Brief;
  theme: Theme;
  slotBriefId: string;
  metaForCaption: AccountMetaLite;
  acctResult: AutoGenerateAccountResult;
}

/**
 * FILL-DIAGNOSIS-V1: the distinct reasons a fill plans nothing. Only
 * 'calendar-full' actually means what the old message said.
 */
export type EmptyPlanReason =
  | 'no-accounts'        // nothing connected that can publish
  | 'no-briefs'          // connected, but no account has an active brief
  | 'no-posting-times'   // briefed, but no posting slots in the window
  | 'no-themes'          // slots exist, but no enabled theme matches the brief
  | 'calendar-full';     // every slot in the window already holds a post

export interface FillPlan {
  settings: EffectiveSocialSettings;
  lookaheadDays: number;
  rangeEnd: string;
  briefs: Brief[];
  existingPosts: SocialPostDraft[];
  brainItems: BrainItemLite[];
  imageUsage: ImageUsageMap;
  themeUsage: Map<string, number>;
  cooldownDays: number;
  captionSource: CaptionSourcePost[];
  captionModel: ReturnType<typeof captionModelSpec>;
  specs: SlotSpec[];
  /** FILL-DIAGNOSIS-V1: why the plan is empty, when it is. */
  emptyReason?: EmptyPlanReason;
  /** SHORTLIST-CACHE-V1: shortlists already computed for this library. */
  shortlists: ShortlistCache;
  /** Fingerprint the shortlists were computed against. */
  brainFingerprint: string;
  /** Counters the planning phase produces for the run report. */
  skippedCount: number;
  skippedNoThemes: number;
  details: AutoGenerateAccountResult[];
}

export async function planFill(input: RunInput, now: Date): Promise<FillPlan> {
  let skippedCount = 0;
  let skippedNoThemes = 0;
  const details: AutoGenerateAccountResult[] = [];
  // FILL-DIAGNOSIS-V1 — why a plan came back empty.
  //
  // "Calendar is full" used to be said whenever no slots were planned, which
  // is the same outcome whether every slot really is taken or the engine
  // could not see an account. Those need opposite things from the reader,
  // and the confident version of the wrong one wastes their time.
  let accountsCanPost = 0;
  let accountsWithBriefs = 0;
  let slotsInWindow = 0;
    // 1-4. Settings, accounts, briefs, the calendar and the Brain.
    //
    // FILL-SETUP-DIRECT-V1
    //
    // This is server code, and almost everything it needs is a Netlify Blobs
    // document it can read itself. It was instead calling its OWN HTTP API
    // for each one: six requests out through the CDN and back into the
    // function runtime, each able to cold-start its own instance, for data
    // sitting one `getCollection` away.
    //
    // That cost is what the generation loop was paying for. The budget is
    // measured from the top of this function, so every second here is a
    // second the loop does not get, and on a real account (151 posts, 324
    // Brain images) setup consumed the entire window: the run created
    // NOTHING and reported "the server ran out of time before it could
    // start writing". Making the six calls concurrent helped and was not
    // enough — the fix is not to make them.
    //
    // /api/accounts/status stays an HTTP call: it derives publishing
    // capability from the OAuth token store rather than just reading a
    // document, and duplicating that logic here is how the two would drift.
    // One request is affordable; six were not.
    const [settings, accountsJson, accountMetasRaw, briefsRaw, postsRaw, brain] =
      await Promise.all([
        getEffectiveSettings(),
        fetchJsonInternal(input.origin, '/api/accounts/status', input.internalSecret),
        getCollection<AccountMetaLite[]>(DEFAULT_USER_ID, 'account_meta'),
        getCollection<Brief[]>(DEFAULT_USER_ID, 'briefs'),
        getCollection<SocialPostDraft[]>(DEFAULT_USER_ID, 'social_posts'),
        // The Brain is optional: without it every picker falls through to
        // Unsplash, which is worse imagery but still a working fill.
        Promise.all([getBrainItems(), getBrainFolders()])
          .then(([items, folders]) => ({ items, folders }))
          .catch(() => ({ items: [] as any[], folders: [] as any[] })),
      ]);

    const lookaheadDays = input.lookaheadDaysOverride
      || settings.lookaheadDays
      || DEFAULT_LOOKAHEAD_DAYS;

    const rangeEnd = new Date(now);
    rangeEnd.setDate(rangeEnd.getDate() + lookaheadDays);

    const realAccounts: RealAccountLite[] = accountsJson?.realAccounts || [];
    const accountMetas: AccountMetaLite[] = Array.isArray(accountMetasRaw) ? accountMetasRaw : [];
    const briefs: Brief[] = Array.isArray(briefsRaw) ? briefsRaw : [];
    const existingPosts: SocialPostDraft[] = Array.isArray(postsRaw) ? postsRaw : [];

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

    // 5. Brain items. The stored items are raw (blobId + mime + tags, with NO
    // url field), so the old `.filter(b => b.url)` dropped every one and
    // Brain images were never used here. Build the absolute image URL
    // ourselves — absolute because it is stored on the post and fetched by
    // Meta at publish time, which cannot resolve a relative path. Image MIME
    // only: text/markdown Brain items aren't postable.
    const folderNameById = new Map<string, string>();
    for (const f of brain.folders) {
      if (f?.id && f?.name) folderNameById.set(f.id, f.name);
    }
    const brainItems: BrainItemLite[] = brain.items
      .filter((i: any) => typeof i?.mime === 'string' && i.mime.startsWith('image/') && i.blobId)
      .map((i: any) => ({
        id: i.id,
        url: `${input.origin}/api/images/${i.blobId}`,
        description: i.description,
        credit: i.description,
        tags: i.tags,
        folder: i.folderId ? folderNameById.get(i.folderId) : undefined,
      }));

    // SHORTLIST-CACHE-V1: keyed by the library, so it can only be loaded
    // once the Brain is known. One small blob read.
    const fingerprint = brainFingerprint(brainItems);
    const shortlists = await readShortlists(fingerprint);

    // 6. Collect every slot that needs a post. This phase is fast and
    // synchronous — dedup + brief/theme picking only, NO AI calls — so we
    // know the full workload before spending any of the time budget.
    const specs: SlotSpec[] = [];

    for (const account of realAccounts) {
      if (!account.capabilities?.canPost) continue;
      accountsCanPost += 1;
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
      accountsWithBriefs += 1;

      const slots = settings.postingTimes[account.platform] || [];
      const datetimes = expandSlots(slots, now, lookaheadDays);
      slotsInWindow += datetimes.length;

      const acctResult: AutoGenerateAccountResult = {
        accountId: account.id,
        // For multi-brief accounts this just shows the first assigned brief
        // — purely informational for the run report.
        briefId: activeBriefIds[0],
        created: 0,
        skipped: 0,
        themeIdsUsed: [],
      };
      details.push(acctResult);

      for (const iso of datetimes) {
        // Skip if a post already exists for this account at this time.
        const dup = existingPosts.find(p =>
          p.accountIds.includes(account.id) && p.scheduledAt === iso
        );
        if (dup) {
          acctResult.skipped += 1;
          skippedCount += 1;
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
          skippedNoThemes += 1;
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

  return {
    settings,
    lookaheadDays,
    rangeEnd: rangeEnd.toISOString(),
    briefs,
    existingPosts,
    brainItems,
    imageUsage,
    themeUsage,
    cooldownDays,
    captionSource,
    captionModel,
    specs,
    emptyReason:
      specs.length > 0
        ? undefined
        : accountsCanPost === 0
          ? 'no-accounts'
          : accountsWithBriefs === 0
            ? 'no-briefs'
            : slotsInWindow === 0
              ? 'no-posting-times'
              : skippedNoThemes > 0 && skippedCount === 0
                ? 'no-themes'
                : 'calendar-full',
    shortlists,
    brainFingerprint: fingerprint,
    skippedCount,
    skippedNoThemes,
    details,
  };
}

/**
 * IMAGE-SEMANTIC-V1: a per-(theme, brief) shortlist, memoised for one run.
 *
 * The PROMISE is cached, not the result: the slots in a concurrent batch
 * would otherwise each fire the same request before any of them had an
 * answer to store.
 */
export interface RankCache {
  get: (theme: Theme, brief: Brief | undefined) => Promise<SemanticRank | null>;
  /** Persist anything newly computed. Safe to call with nothing new. */
  flush: () => Promise<void>;
}

export function makeRankCache(
  input: RunInput,
  brainItems: BrainItemLite[],
  settings: EffectiveSocialSettings,
  persisted?: ShortlistCache,
  fingerprint?: string
): RankCache {
  const cache = new Map<string, Promise<SemanticRank | null>>();
  const fresh = new Map<string, string[]>();

  const get = (theme: Theme, brief: Brief | undefined) => {
    if (!settings.semanticImageMatch) return Promise.resolve(null);
    const key = theme.id + '|' + (brief?.id || '');
    const hit = cache.get(key);
    if (hit) return hit;

    // SHORTLIST-CACHE-V1: a shortlist already computed for this library is
    // the same answer, not an approximation of it, so there is nothing to
    // weigh up — use it and skip the request.
    const stored = persisted?.hits.get(key);
    if (stored) {
      const rank: SemanticRank = new Map();
      stored.forEach((url, i) => rank.set(url, i));
      const resolved = Promise.resolve(rank);
      cache.set(key, resolved);
      return resolved;
    }

    const pending = fetchSemanticRank(
      input.origin,
      brainItems,
      theme.title + ' ' + theme.prompt,
      { briefName: brief?.name, internalSecret: input.internalSecret }
    ).then(rank => {
      if (rank && rank.size > 0) {
        fresh.set(key, [...rank.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]));
      }
      return rank;
    });
    cache.set(key, pending);
    return pending;
  };

  return {
    get,
    flush: async () => {
      if (!fingerprint || fresh.size === 0) return;
      await writeShortlists(fingerprint, fresh);
    },
  };
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
    // 1-6. Plan the whole fill before spending any of the time budget.
    const plan = await planFill(input, now);
    const {
      settings, existingPosts, brainItems, imageUsage, cooldownDays,
      captionSource, captionModel, specs,
    } = plan;
    result.rangeEnd = plan.rangeEnd;
    result.skippedCount = plan.skippedCount;
    result.skippedNoThemes = plan.skippedNoThemes;
    result.details = plan.details;
    result.emptyReason = plan.emptyReason;

    const ranker = makeRankCache(
      input, brainItems, settings, plan.shortlists, plan.brainFingerprint
    );

    // CAPTION-ERRORS-V1: distinct failure reasons, in first-seen order.
    // Deduplicated because 40 identical rate-limit messages say no more than
    // one, and capped so a pathological run cannot balloon the response.
    const captionErrors: string[] = [];
    const noteCaptionError = (message: string) => {
      if (captionErrors.length < 3 && !captionErrors.includes(message)) {
        captionErrors.push(message);
      }
    };

    const newPosts: SocialPostDraft[] = [];
    // Track every image used in this run so the pickers can avoid handing
    // the same photo to multiple posts (the "same image all month" bug).
    const usedImageUrls = new Set<string>();

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
    // FILL-BUDGET-V2
    //
    // Expressed as a DEADLINE rather than a stopwatch. The question before
    // each batch is "is there room for another one before the ceiling?", and
    // a stopwatch against a constant answers a different question — one that
    // silently stops being true as the setup phase grows. The first version
    // subtracted a fixed reserve from 24s and compared elapsed time to it,
    // which left 2.5s for setup on Sonnet and produced runs that created
    // NOTHING on a real account and reported "generation stalled".
    //
    // The reserve is also honest about the shortlist now. A ranking is
    // memoised per invocation AND persisted across them, so only a cold
    // cache can ever pay for one — reserving it on every batch was reserving
    // time that in practice is never spent.
    const deadline = startedAt + SYNC_CEILING_MS;

    // FILL-BUDGET-V3 — express the window as the LAST MOMENT a batch can
    // still start, and make every other phase fit inside that.
    //
    // The previous version compared each phase against the deadline with its
    // own arithmetic, and the warm loop's guard came out algebraically
    // IDENTICAL to the batch guard:
    //
    //   warm wave:  now + caption + persist  >  deadline  -> stop warming
    //   batch:      now + caption + persist <=  deadline  -> run a batch
    //
    // So warming ran waves until the exact instant the batch guard would
    // fail, then stopped — leaving it failing. By construction, any run that
    // warmed to its limit could never write a post. That is the "server ran
    // out of time before it could start writing" report, and it is why the
    // symptom flipped back from "generation stalled" the moment waves were
    // introduced. Reproduced at 2,500ms per ranking over 19 pairs: 16
    // rankings, 0 posts.
    //
    // One anchor removes the whole class of mistake: warming may consume the
    // window only up to the point where a batch still fits after it.
    const lastBatchStart = deadline - captionModel.captionTimeoutMs - PERSIST_RESERVE_MS;
    const roomForAnotherBatch = () => Date.now() <= lastBatchStart;
    /** A warm wave may start only if it can finish AND leave a batch room. */
    const roomToWarm = () => Date.now() + SHORTLIST_TIMEOUT_MS <= lastBatchStart;
    const CONCURRENCY = 4;
    /** SHORTLIST-BURST-V1: how many rankings may be in flight at once. */
    const WARM_CONCURRENCY = 4;

    // FILL-BUDGET-V2 — ranking happens HERE, never inside the loop.
    //
    // Ranking inside the loop forced every batch to reserve the shortlist
    // timeout on top of the caption timeout, and that reserve is what
    // starved setup down to 2.5s. Worse, it deadlocked on a cold cache: no
    // room for a batch meant no batch ran, nothing was ranked, the cache
    // stayed cold, and the next invocation hit exactly the same wall.
    //
    // Warming up front fixes both. Every distinct (theme, brief) pair goes
    // out concurrently, so the cost is ONE ranking latency however many
    // pairs there are, it is paid once, and it is persisted immediately —
    // so even an invocation with no time left to generate leaves the next
    // one faster. The loop then reserves only the caption timeout.
    const warmed = new Map<string, SemanticRank | null>();
    const pairKey = (spec: SlotSpec) => spec.theme.id + '|' + spec.slotBriefId;
    if (settings.semanticImageMatch && roomToWarm()) {
      const pairs = new Map<string, SlotSpec>();
      for (const spec of specs) pairs.set(pairKey(spec), spec);
      // SHORTLIST-BURST-V1
      //
      // Warm in bounded waves, not all at once. Each ranking sends the whole
      // photo catalogue — roughly 8,000 tokens for a 324-image Brain — so
      // firing every distinct pair concurrently puts a six-figure token
      // burst on the account in one second, immediately before the caption
      // calls need the same quota. A rate limit there fails every caption in
      // the run, and the run had no way to say so.
      //
      // Four at a time matches the batch width the captions themselves use.
      const entries = [...pairs.entries()];
      for (let i = 0; i < entries.length; i += WARM_CONCURRENCY) {
        // Stop warming rather than eat the budget the captions need; an
        // unwarmed pair just falls back to the lexical ranking and is warmed
        // by a later invocation, since the results persist.
        if (!roomToWarm()) break;
        await Promise.all(
          entries.slice(i, i + WARM_CONCURRENCY).map(async ([key, spec]) => {
            warmed.set(key, await ranker.get(spec.theme, spec.slotBrief));
          })
        );
      }
      // Persist before generating, so a run that ends up with no time to
      // write a post still moves the fill forward.
      await ranker.flush();
    } else if (settings.semanticImageMatch) {
      // Not enough of the window left to rank AND generate. Generating is
      // the more valuable half, so this invocation falls back to lexical
      // ranking (IMAGE-RANK-V2) rather than doing nothing.
      result.semanticSkipped = true;
    }
    let postSeq = 0;

    for (let i = 0; i < specs.length; i += CONCURRENCY) {
      if (!roomForAnotherBatch()) {
        result.stoppedEarly = true;
        result.pendingCount = specs.length - i;
        // Distinguish "the window filled up mid-run", which is normal and
        // continues on the next click, from "there was never room for even
        // one batch", which is the starvation FILL-BUDGET-V2 fixed and which
        // the UI previously reported as the misleading "generation stalled".
        if (i === 0) result.noRoomForBatch = true;
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
          // Warmed above — never a network call from inside the loop, so a
          // batch's cost is exactly one caption timeout. A pair that was not
          // warmed falls back to the lexical ranking.
          const semanticRank = warmed.get(spec.theme.id + '|' + spec.slotBriefId) || null;
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
          const outcome = await generateCaption(
            input.origin, spec.slotBrief, spec.theme, spec.metaForCaption,
            spec.account, input.internalSecret, spec.iso,
            imageForCaption,
            { history, model: captionModel.id },
          );
          const caption = outcome.text;
          // Don't persist a body-less draft — leave the slot empty so the
          // next Fill calendar run retries it. CAPTION-ERRORS-V1: keep the
          // reason, so a run where every caption failed can say why instead
          // of advising the user to wait.
          if (!caption) {
            console.warn('[social-cron] empty caption — skipping slot', spec.iso, outcome.error);
            if (outcome.error) noteCaptionError(outcome.error);
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
        } catch (err: any) {
          // FILL-DIAGNOSIS-V2: a slot that threw before or after the caption
          // call counts in errorCount like any other, so it has to contribute
          // a reason too — otherwise the run reports failures it cannot
          // explain and the UI falls back to "check the function logs", which
          // the person clicking the button generally cannot do.
          const message = err?.message || String(err);
          console.error('[social-cron] slot generation failed:', message);
          noteCaptionError(`slot generation failed: ${message}`);
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
      // FILL-SETUP-DIRECT-V1: read and write the blob directly, like the
      // rest of setup. These two sat inside PERSIST_RESERVE_MS (2.5s) and
      // were two more HTTP round-trips into our own runtime for a document
      // this process can open itself.
      let base: SocialPostDraft[];
      try {
        const fresh = await getCollection<SocialPostDraft[]>(DEFAULT_USER_ID, 'social_posts');
        base = Array.isArray(fresh) ? fresh : existingPosts;
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
      await saveCollection(DEFAULT_USER_ID, 'social_posts', all);
    }

    if (captionErrors.length > 0) result.captionErrors = captionErrors;
    result.ok = true;
  } catch (err: any) {
    console.error('[social-cron] runAutoGenerate failed:', err);
    result.error = err?.message || 'Unknown error';
    result.errorCount = 1;
  }

  // 8. Notification (de-duped within 24h).
  //
  // Deliberately outside the try: a blob write that fails here used to be
  // caught above and reported as a failed RUN, discarding drafts that had
  // already been saved. The notification is now the last thing that happens
  // and cannot change the outcome it is describing.
  await notifyRunOutcome(result);

  result.durationMs = Date.now() - startedAt;
  return result;
}

/**
 * AUTOGEN-FAILURE-NOTIFS-V1: write whatever lib/autogen-notify.ts decided this
 * run deserves. The rule lives there; the blob write lives here.
 */
async function notifyRunOutcome(result: AutoGenerateRunResult): Promise<void> {
  const notification = runOutcomeNotification(result, new Date().toISOString().slice(0, 10));
  if (!notification) return;
  try {
    await addNotification(notification);
  } catch (err: any) {
    // Never let the bell take the run down with it.
    console.error('[social-cron] could not write run notification:', err?.message || err);
  }
}
