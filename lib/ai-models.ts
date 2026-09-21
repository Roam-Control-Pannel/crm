/**
 * AI-MODELS-V1
 *
 * One place that names the Anthropic models this app calls, so a model
 * upgrade is a single edit rather than a grep across six files.
 *
 * Before this module the codebase carried four different ids — three of
 * them two generations behind (`claude-sonnet-4-6` as the /api/ai/chat
 * default, `claude-sonnet-4-5` in the social composer, and
 * `claude-sonnet-4-20250514` for Brain vision tagging). Nothing pointed at
 * the current family, and nothing made that visible.
 *
 * No runtime deps: the settings UI imports the catalogue to build a picker
 * and the server imports the same constants to validate what comes back, so
 * the two can't drift.
 */

/** Everyday text generation: captions, briefs, rewrites, the Roam-io chat. */
export const MODEL_SONNET = 'claude-sonnet-5';

/** Deepest reasoning and the strongest prose. Slower — see captionTimeoutMs. */
export const MODEL_OPUS = 'claude-opus-5';

/** Cheapest and fastest. Good for short, mechanical classification work. */
export const MODEL_HAIKU = 'claude-haiku-4-5';

/**
 * Default for /api/ai/chat when a caller names no model. Sonnet is the right
 * floor: strong enough for copy, fast enough to finish inside the platform's
 * synchronous-function ceiling.
 */
export const DEFAULT_CHAT_MODEL = MODEL_SONNET;

/** Vision model for auto-describing Brain uploads. */
export const BRAIN_VISION_MODEL = MODEL_SONNET;

/**
 * IMAGE-SEMANTIC-V1: the model that ranks Brain photos against a post theme.
 *
 * Sonnet rather than Haiku. The work is cheap either way — one request per
 * theme per run against a catalogue that caches — and the difference between
 * the tiers is exactly the judgement this call exists to supply: deciding
 * that a quiet side street suits a theme about wrong turns is not a lookup.
 */
export const SHORTLIST_MODEL = MODEL_SONNET;

/**
 * Per-ranking timeout. Subtracted from the Fill calendar batch budget in
 * lib/social-cron.ts alongside the caption timeout, so adding this step
 * cannot push a run past the hosting platform's synchronous ceiling — it
 * just places fewer slots per click.
 */
export const SHORTLIST_TIMEOUT_MS = 6_000;

export interface CaptionModelSpec {
  id: string;
  label: string;
  /** One line for the settings UI. */
  blurb: string;
  /**
   * How long a single caption generation is allowed to take before we abort
   * it. Sized per model because output speed is what differs, and because
   * the whole Fill-calendar batch has to finish inside the platform's ~26s
   * synchronous-function ceiling (see TIME_BUDGET in lib/social-cron.ts,
   * which is derived from this number rather than hard-coded alongside it).
   */
  captionTimeoutMs: number;
  /**
   * Minimum prompt length, in tokens, before Anthropic will cache a prefix.
   * Documented per model; below it a `cache_control` marker is ignored
   * rather than rejected. Recorded here so the caching we ask for can be
   * reasoned about honestly instead of assumed.
   */
  minCacheableTokens: number;
}

/**
 * Models offered for social caption writing. Deliberately short: these are
 * the two that make sense for the job. Haiku is not offered — the whole
 * point of the caption path is prose quality.
 */
export const CAPTION_MODELS: CaptionModelSpec[] = [
  {
    id: MODEL_SONNET,
    label: 'Sonnet 5 (recommended)',
    blurb:
      'Fast, strong copy. Finishes comfortably inside the hosting time limit, so a Fill calendar run places more slots per click.',
    captionTimeoutMs: 13_000,
    minCacheableTokens: 1024,
  },
  {
    id: MODEL_OPUS,
    label: 'Opus 5 (best writing, slower)',
    blurb:
      'The strongest writer. Slower, so each Fill calendar click places fewer slots — you just click it more times.',
    captionTimeoutMs: 18_000,
    minCacheableTokens: 512,
  },
];

export const DEFAULT_CAPTION_MODEL = MODEL_SONNET;

/**
 * Resolve a stored/user-supplied model id to a spec. Unknown ids fall back
 * to the default rather than being passed through to the API: the id comes
 * from a settings blob that a bad write could corrupt, and a 400 from
 * Anthropic would surface as "every caption is empty".
 */
export function captionModelSpec(id?: string): CaptionModelSpec {
  const found = id ? CAPTION_MODELS.find(m => m.id === id) : undefined;
  return found || CAPTION_MODELS.find(m => m.id === DEFAULT_CAPTION_MODEL)!;
}

export function isKnownCaptionModel(id: unknown): boolean {
  return typeof id === 'string' && CAPTION_MODELS.some(m => m.id === id);
}
