import { NextRequest, NextResponse } from 'next/server';
import {
  buildCatalogue,
  buildThemeQuestion,
  parseShortlist,
  SHORTLIST_SCHEMA,
  SHORTLIST_SIZE,
  MAX_CATALOGUE,
  type ShortlistCandidate,
} from '@/lib/image-shortlist';
import { SHORTLIST_MODEL, SHORTLIST_TIMEOUT_MS } from '@/lib/ai-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * IMAGE-SEMANTIC-V1
 *
 * POST /api/social/rank-images
 *   body: { items: [{url, description?, tags?, folder?}], theme: string,
 *           briefName?: string, count?: number }
 *   -> { ok: true, ranked: string[] }   urls, best first
 *   -> { ok: true, ranked: [] }         the model could not help; caller
 *                                        falls back to lexical scoring
 *
 * Auth: not in middleware's PUBLIC_API_ROUTES, so it needs either a signed-in
 * session or the x-internal-call secret — the same door /api/ai/chat uses.
 * That is what lets the browser's "Generate with AI" and the server-side Fill
 * calendar share one implementation.
 *
 * This route never fails the caller's job. Every error path returns 200 with
 * an empty `ranked`, because a missing shortlist means "rank lexically", not
 * "abandon the post". The one exception is a malformed request body, which is
 * a bug worth seeing.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const items: ShortlistCandidate[] = Array.isArray(body?.items) ? body.items : [];
  const theme: string = typeof body?.theme === 'string' ? body.theme : '';
  if (items.length === 0 || !theme.trim()) {
    return NextResponse.json({ ok: false, error: 'items and theme are required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[rank-images] ANTHROPIC_API_KEY is not set — falling back to lexical ranking');
    return NextResponse.json({ ok: true, ranked: [] });
  }

  // Cap the catalogue. The caller pre-sorts by lexical relevance, so the first
  // MAX_CATALOGUE entries are the plausible ones; this bounds both the prompt
  // and the chance of the model losing track partway down a very long list.
  const catalogueItems = items.slice(0, MAX_CATALOGUE);
  const count = Math.min(
    Math.max(1, Number(body?.count) || SHORTLIST_SIZE),
    catalogueItems.length
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHORTLIST_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: SHORTLIST_MODEL,
        max_tokens: 300,
        // The catalogue is byte-identical for every theme in a run, so it is
        // the cacheable prefix; the theme is the only thing that varies and
        // it lives in the user turn, after the breakpoint.
        system: [
          {
            type: 'text',
            text: buildCatalogue(catalogueItems),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: buildThemeQuestion(theme, body?.briefName, count),
          },
        ],
        // Structured outputs: the answer is guaranteed to be JSON matching
        // this schema, in the text block. No fence-stripping, no regex salvage.
        output_config: { format: { type: 'json_schema', schema: SHORTLIST_SCHEMA } },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[rank-images] anthropic ${res.status}: ${detail.slice(0, 300)}`);
      return NextResponse.json({ ok: true, ranked: [] });
    }

    const data: any = await res.json();
    const usage = data?.usage;
    if (usage) {
      console.log(
        `[rank-images] cache: written=${usage.cache_creation_input_tokens || 0} ` +
          `read=${usage.cache_read_input_tokens || 0} uncached=${usage.input_tokens || 0}`
      );
    }

    const text: string = data?.content?.[0]?.text || '';
    let parsedJson: unknown = null;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      console.error('[rank-images] response was not JSON:', text.slice(0, 200));
      return NextResponse.json({ ok: true, ranked: [] });
    }

    const rank = parseShortlist(parsedJson, catalogueItems);
    if (!rank) return NextResponse.json({ ok: true, ranked: [] });

    // Serialise the Map as an ordered url list — JSON has no Map, and the
    // order IS the rank, so the client rebuilds it without a second field to
    // keep in sync.
    const ranked = [...rank.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
    return NextResponse.json({ ok: true, ranked });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.warn('[rank-images] timed out — falling back to lexical ranking');
    } else {
      console.error('[rank-images] failed:', err);
    }
    return NextResponse.json({ ok: true, ranked: [] });
  } finally {
    clearTimeout(timer);
  }
}
