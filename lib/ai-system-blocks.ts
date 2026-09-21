/**
 * AI-SYSTEM-BLOCKS-V1
 *
 * Shaping the `system` field of an Anthropic request. Lives outside
 * app/api/ai/chat/route.ts so it can be tested directly, and so a route
 * file exports nothing but its handlers.
 *
 * PROMPT-CACHE-V1
 *
 * `systemPrompt` used to be a plain string that went straight to Anthropic.
 * Callers may now send an array of content blocks instead, so a stable
 * prefix can be marked with `cache_control` and reused across calls — see
 * generateCaption in lib/social-cron.ts, which splits the brief and brand
 * voice (identical for every post in a Fill calendar run) from the per-slot
 * theme, image and already-published context.
 *
 * Whitelisted rather than passed through: this route is reachable by any
 * signed-in operator, and an arbitrary object array would be a way to shape
 * the upstream request body directly. Only `text` blocks survive, only
 * `cache_control.type` is honoured, and Anthropic's limit of four cache
 * breakpoints is enforced here so a caller can't trip a 400 that would
 * surface as "the AI stopped working".
 *
 * A prefix shorter than the model's minimum (512 tokens on Opus 5, 1,024 on
 * Sonnet 5) is simply not cached; the marker is ignored, not rejected.
 */
export const MAX_CACHE_BREAKPOINTS = 4;

export function normaliseSystem(systemPrompt: any): any {
  if (typeof systemPrompt === 'string' || systemPrompt == null) return systemPrompt;
  if (!Array.isArray(systemPrompt)) return undefined;
  let breakpoints = 0;
  const blocks: any[] = [];
  for (const raw of systemPrompt) {
    const text = raw && typeof raw.text === 'string' ? raw.text : '';
    if (!text) continue;
    const block: any = { type: 'text', text };
    const wantsCache = raw?.cache_control?.type === 'ephemeral';
    if (wantsCache && breakpoints < MAX_CACHE_BREAKPOINTS) {
      block.cache_control = { type: 'ephemeral' };
      breakpoints += 1;
    }
    blocks.push(block);
  }
  return blocks.length > 0 ? blocks : undefined;
}
