import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { messages, systemPrompt } = await req.json();

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Anthropic API error:', data);
      return NextResponse.json(
        { error: data.error?.message || 'Anthropic API error' },
        { status: res.status }
      );
    }

    return NextResponse.json({ content: data.content?.[0]?.text || '' });
  } catch (err) {
    console.error('Route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
