import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Brain storage — must match /api/brain/items so we can load existing
// memory descriptions to dedupe against. One Blob read per request.
const META_STORE = 'roam-brain';
const ITEMS_KEY = 'items';
const MEMORY_TAG = 'roam-io-memory';

// Fuzzy Jaccard threshold for description matching. 0.7 picked
// empirically — catches paraphrases without flagging distinct facts.
// Override via Netlify env var MEMORY_DEDUPE_THRESHOLD (0.0 - 1.0).
const DEFAULT_DEDUPE_THRESHOLD = 0.7;
function getDedupeThreshold(): number {
  const raw = process.env.MEMORY_DEDUPE_THRESHOLD;
  if (!raw) return DEFAULT_DEDUPE_THRESHOLD;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_DEDUPE_THRESHOLD;
  return n;
}

// =================================================================
// Dedupe helpers
// =================================================================

interface BrainItemLite {
  id: string;
  blobId: string;
  tags: string[];
  description: string;
}

interface MemoryCandidate {
  description: string;
  content: string;
  tags: string[];
}

/**
 * Load the description of every existing memory item. We only need
 * descriptions — they're short, model-constrained one-liners that make
 * much better fingerprints than the longer content body.
 */
async function loadExistingMemoryDescriptions(): Promise<string[]> {
  try {
    const metaStore = getStore(META_STORE);
    const items = ((await metaStore.get(ITEMS_KEY, { type: 'json' })) as BrainItemLite[]) || [];
    return items
      .filter(i => Array.isArray(i.tags) && i.tags.includes(MEMORY_TAG))
      .map(i => i.description || '')
      .filter(d => d.length > 0);
  } catch (err) {
    console.error('loadExistingMemoryDescriptions failed:', err);
    return [];
  }
}

/**
 * Lowercase, collapse whitespace, strip punctuation, normalise smart
 * quotes to straight quotes. Result is what we compare for "identical".
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")   // smart -> straight quotes
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')              // strip punctuation/emoji
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token set for Jaccard. Words of 4+ chars only — skips "the", "and",
 * "with" etc. that would dominate the score without carrying meaning.
 */
function tokenSet(s: string): Set<string> {
  return new Set(normalise(s).split(' ').filter(w => w.length >= 4));
}

/**
 * Jaccard similarity over two token sets. Returns 0.0 - 1.0.
 *   |A ∩ B| / |A ∪ B|
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Return the candidates that survive dedupe, plus a count of how many
 * were dropped. Two passes:
 *   1. Against existing stored memories
 *   2. Within the surviving batch (catches Claude emitting two similar
 *      memories in one extraction)
 */
function dedupeCandidates(
  candidates: MemoryCandidate[],
  existingDescriptions: string[],
  threshold: number,
): { kept: MemoryCandidate[]; dropped: number } {
  if (candidates.length === 0) return { kept: [], dropped: 0 };

  // Pre-tokenise existing descriptions for speed.
  const existingFingerprints = existingDescriptions.map(d => ({
    normalised: normalise(d),
    tokens: tokenSet(d),
  }));

  const survivors: MemoryCandidate[] = [];
  let dropped = 0;

  for (const cand of candidates) {
    const candNorm = normalise(cand.description);
    const candTokens = tokenSet(cand.description);

    let isDupe = false;
    for (const ex of existingFingerprints) {
      // Level 1: identical normalised description (definitive match)
      if (candNorm && candNorm === ex.normalised) {
        isDupe = true;
        break;
      }
      // Level 2: fuzzy Jaccard
      if (jaccard(candTokens, ex.tokens) >= threshold) {
        isDupe = true;
        break;
      }
    }

    if (isDupe) {
      dropped++;
    } else {
      survivors.push(cand);
    }
  }

  // Pass 2: dedupe within the surviving batch.
  const batchResult = dedupeWithinBatch(survivors, threshold);
  return { kept: batchResult.kept, dropped: dropped + batchResult.dropped };
}

/**
 * Dedupe a list against itself. Keeps the FIRST occurrence of any
 * near-duplicate cluster, drops the rest.
 */
function dedupeWithinBatch(
  candidates: MemoryCandidate[],
  threshold: number,
): { kept: MemoryCandidate[]; dropped: number } {
  if (candidates.length < 2) return { kept: candidates, dropped: 0 };

  const kept: MemoryCandidate[] = [];
  const keptFingerprints: Array<{ normalised: string; tokens: Set<string> }> = [];
  let dropped = 0;

  for (const cand of candidates) {
    const fp = {
      normalised: normalise(cand.description),
      tokens: tokenSet(cand.description),
    };
    let isDupe = false;
    for (const seen of keptFingerprints) {
      if (fp.normalised && fp.normalised === seen.normalised) { isDupe = true; break; }
      if (jaccard(fp.tokens, seen.tokens) >= threshold) { isDupe = true; break; }
    }
    if (isDupe) {
      dropped++;
    } else {
      kept.push(cand);
      keptFingerprints.push(fp);
    }
  }
  return { kept, dropped };
}

/**
 * /api/ai/memory — extract durable memory facts from a chat transcript.
 *
 * POST body: { transcript: string, existingMemories?: string[] }
 *   - transcript: full chat (or chat-since-last-extraction)
 *   - existingMemories: optional array of descriptions Claude has
 *     already extracted from prior runs, so it can dedupe.
 *
 * Returns: { ok: true, memories: [{description, content, tags}] }
 *   - description: one-line summary (Brain card title), <140 chars
 *   - content: full fact text (1-3 sentences, ideally quoting user)
 *   - tags: 2-5 short kebab-case tags
 *
 * Empty array = nothing worth saving (the common case).
 */

const SYSTEM = `You are a memory-extraction model. Given a chat transcript between
"You" (Andy, who runs Roam Local / First Connections / Newcastle First / Darlington First)
and "Roam-io" (his AI growth assistant), extract DURABLE facts worth remembering across
future conversations.

What counts as durable:
- Named contacts (names, emails, phone numbers, roles, organisations)
- Decisions made and committed to ("posting times set to 9/1/5", "focus on indie hotels")
- Active projects and their state ("Dún Laoghaire pitch in week 2", "Whitstable activated Tue")
- Stated preferences ("don't pitch chains", "always Q4 first for retail")
- Key numbers and metrics that came up
- Relationships and partnerships ("Sarah at Belfast City Council handles X")

What does NOT count:
- Conversational filler, greetings, acknowledgments
- Questions Andy asked (we want answers, not questions)
- Things Roam-io guessed or suggested but Andy didn't confirm
- Trivial single-use info ("I'm tired today")
- Anything already covered by an existing memory (dedupe via the list provided)

Return ONLY valid JSON in this exact shape, no markdown, no preamble:
{"memories": [{"description": "...", "content": "...", "tags": ["...", "..."]}]}

If nothing durable, return: {"memories": []}

Each memory:
- description: one factual line, <140 chars, no quotes
- content: 1-3 sentences with the full fact, quoting Andy's wording when possible
- tags: 2-5 lowercase kebab-case keywords (e.g. "dun-laoghaire", "contact-info", "decision")`;

export async function POST(req: NextRequest) {
  try {
    const { transcript, existingMemories } = await req.json();
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ ok: false, error: 'No API key' }, { status: 500 });
    }
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
      // Not enough material — skip silently rather than calling Claude.
      return NextResponse.json({ ok: true, memories: [] });
    }

    const existingBlock = Array.isArray(existingMemories) && existingMemories.length > 0
      ? `\n\nEXISTING MEMORIES (skip duplicates):\n${existingMemories.map(m => '- ' + m).join('\n')}`
      : '';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `TRANSCRIPT:\n\n${transcript.slice(0, 30_000)}${existingBlock}`,
          },
        ],
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      console.error('memory extraction upstream error:', res.status, raw.slice(0, 300));
      return NextResponse.json({ ok: false, error: `Upstream ${res.status}` }, { status: 502 });
    }

    let data: any;
    try { data = JSON.parse(raw); } catch {
      return NextResponse.json({ ok: false, error: 'Bad upstream JSON' }, { status: 502 });
    }

    const text = data?.content?.[0]?.text || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch {
      console.error('memory extraction returned unparseable JSON:', cleaned.slice(0, 300));
      return NextResponse.json({ ok: true, memories: [] });
    }

    const memories = Array.isArray(parsed?.memories) ? parsed.memories : [];
    // Sanity-check each memory shape and trim to safe bounds.
    const clean: MemoryCandidate[] = memories
      .filter((m: any) => m && typeof m.description === 'string' && typeof m.content === 'string')
      .map((m: any) => ({
        description: m.description.slice(0, 140),
        content: m.content.slice(0, 2000),
        tags: Array.isArray(m.tags) ? m.tags.slice(0, 8).filter((t: any) => typeof t === 'string') : [],
      }))
      .slice(0, 20); // never more than 20 in a single extraction pass

    // Server-side dedupe pass. Compares each candidate description
    // against every existing memory description AND against the other
    // candidates in this batch. Cheap — one extra Blob read.
    let duplicates = 0;
    let finalMemories = clean;
    if (clean.length > 0) {
      const existingDescs = await loadExistingMemoryDescriptions();
      const result = dedupeCandidates(clean, existingDescs, getDedupeThreshold());
      finalMemories = result.kept;
      duplicates = result.dropped;
    }

    return NextResponse.json({ ok: true, memories: finalMemories, duplicates });
  } catch (err: any) {
    console.error('memory route error:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Failed' }, { status: 500 });
  }
}
