import { NextRequest, NextResponse } from 'next/server';

// Allow this serverless function to run up to 60s (Netlify default is 10s,
// which is too short for AI generations that need ~10-20s).
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { messages, systemPrompt, maxTokens, model } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY is not configured on the server.' },
        { status: 500 }
      );
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // Default to current Sonnet (best price/perf). Caller can override.
        model: model || 'claude-sonnet-4-6',
        // 4096 default — enough for ~3 LinkedIn-length posts wrapped in
        // JSON. Sonnet 4.6 produces meaningfully longer output than the
        // older Sonnet 4 we used to call, and 1024 was getting truncated
        // mid-JSON on social bulk generation, causing every account batch
        // to fail JSON parsing (drafts silently dropped).
        max_tokens: maxTokens || 4096,
        system: systemPrompt,
        messages,
      }),
    });

    // Read body as text first so we can surface non-JSON responses
    // (e.g. gateway HTML error pages) instead of throwing on .json().
    const raw = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error('Anthropic returned non-JSON:', raw.slice(0, 500));
      return NextResponse.json(
        { error: `Upstream returned non-JSON (status ${res.status}). Check function logs.` },
        { status: 502 }
      );
    }

    if (!res.ok) {
      console.error('Anthropic API error:', data);
      return NextResponse.json(
        { error: data?.error?.message || 'Anthropic API error' },
        { status: res.status }
      );
    }

    return NextResponse.json({ content: data?.content?.[0]?.text || '' });
  } catch (err: any) {
    console.error('Route error:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
