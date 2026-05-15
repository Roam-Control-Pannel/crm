import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

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
    const clean = memories
      .filter((m: any) => m && typeof m.description === 'string' && typeof m.content === 'string')
      .map((m: any) => ({
        description: m.description.slice(0, 140),
        content: m.content.slice(0, 2000),
        tags: Array.isArray(m.tags) ? m.tags.slice(0, 8).filter((t: any) => typeof t === 'string') : [],
      }))
      .slice(0, 20); // never more than 20 in a single extraction pass

    return NextResponse.json({ ok: true, memories: clean });
  } catch (err: any) {
    console.error('memory route error:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Failed' }, { status: 500 });
  }
}
