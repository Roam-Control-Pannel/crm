import { NextRequest, NextResponse } from 'next/server';
import { getToolSchemas, executeTool, REQUIRES_CONFIRM } from '@/lib/roamio-tools';

// Allow this serverless function to run up to 60s (Netlify default is 10s,
// which is too short for AI generations that need ~10-20s).
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Hard cap on the tool-use loop so a misbehaving model can't burn the
// function budget. 5 round-trips is plenty for any reasonable
// task (list -> create, or list -> update -> confirm). Bump if you add
// genuinely multi-step workflows later.
const MAX_TOOL_ITERATIONS = 5;

// Although maxDuration is set to 60s, Netlify's plan caps synchronous
// functions at ~26s and hard-kills anything past it — which returns an
// unparseable HTML error page to the client instead of JSON. We stay
// comfortably under that ceiling and always return clean JSON ourselves.
const OVERALL_BUDGET_MS = 24_000;

// Output generation time scales with token count: a 4096-token answer can
// take 20-40s on its own, which alone blows the budget. Chat answers don't
// need that much, so cap the tool/chat path lower. Long-form content
// generation (the non-tool path) can still pass a larger maxTokens.
const CHAT_MAX_TOKENS = 2048;

// Friendly message returned (as normal assistant content, HTTP 200) when we
// run out of time — far better UX than the function being hard-killed.
const TIMEOUT_MESSAGE =
  "Sorry — that took longer than I'm able to spend on a single reply. " +
  'Try asking something more specific, or break it into smaller steps and I can pick up from there.';

async function callAnthropic(
  body: any,
  deadline: number
): Promise<{ ok: boolean; status: number; data: any; raw: string; timedOut?: boolean }> {
  const remaining = deadline - Date.now();
  // Not enough time left to make a meaningful call.
  if (remaining <= 1_000) {
    return { ok: false, status: 0, data: null, raw: '', timedOut: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch { /* handled below */ }
    return { ok: res.ok, status: res.status, data, raw };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, status: 0, data: null, raw: '', timedOut: true };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  const deadline = Date.now() + OVERALL_BUDGET_MS;
  try {
    const { messages, systemPrompt, maxTokens, model, tools, pendingConfirm } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY is not configured on the server.' },
        { status: 500 }
      );
    }

    // tools is an optional array of toolset names, e.g. ['tasks']. When
    // omitted, behaviour is identical to before — single Anthropic call,
    // string content returned. This keeps social/brief generation untouched.
    const toolSchemas: any[] = Array.isArray(tools) ? getToolSchemas(tools) : [];
    const toolMode = toolSchemas.length > 0;

    // pendingConfirm is sent by the client when the user clicks "Confirm"
    // on a tool that has requiresConfirm: true. Shape: { name, input,
    // tool_use_id, assistant_content }. We re-execute the tool now and
    // continue the conversation from there.
    if (pendingConfirm && toolMode) {
      return await runConfirmedTool({
        pendingConfirm,
        messages,
        systemPrompt,
        maxTokens,
        model,
        toolSchemas,
        deadline,
      });
    }

    // ----- First model call ----------------------------------------------
    const baseBody: any = {
      model: model || 'claude-sonnet-4-6',
      max_tokens: maxTokens || (toolMode ? CHAT_MAX_TOKENS : 4096),
      system: systemPrompt,
      messages,
    };
    if (toolMode) baseBody.tools = toolSchemas;

    let { ok, status, data, raw, timedOut } = await callAnthropic(baseBody, deadline);
    if (timedOut) {
      return NextResponse.json({ content: TIMEOUT_MESSAGE });
    }
    if (!ok || !data) {
      console.error('Anthropic error:', data || raw.slice(0, 500));
      return NextResponse.json(
        { error: data?.error?.message || `Upstream error (${status})` },
        { status: status || 502 }
      );
    }

    // ----- Non-tool path: legacy behaviour preserved ---------------------
    if (!toolMode) {
      return NextResponse.json({ content: data?.content?.[0]?.text || '' });
    }

    // ----- Tool-use loop -------------------------------------------------
    // Walk the conversation forward: execute any tool_use blocks, send
    // results back, repeat until Claude stops asking for tools.
    let iterations = 0;
    let convo: any[] = [...messages];

    while (iterations++ < MAX_TOOL_ITERATIONS) {
      const stopReason = data.stop_reason;
      const blocks: any[] = data.content || [];
      const toolUses = blocks.filter((b: any) => b.type === 'tool_use');

      if (stopReason !== 'tool_use' || toolUses.length === 0) {
        // Final response — extract text + any pending tool calls that we
        // chose to defer (requiresConfirm).
        return NextResponse.json(buildClientResponse(blocks));
      }

      // Check whether ANY of the tool calls in this turn require confirm.
      // If so, return early and let the client gate execution. We pass the
      // first such call back so the UI can render its confirm card.
      const pendingTool = toolUses.find((t: any) => REQUIRES_CONFIRM[t.name]);
      if (pendingTool) {
        return NextResponse.json({
          content: extractText(blocks),
          pendingTool: {
            name: pendingTool.name,
            input: pendingTool.input,
            tool_use_id: pendingTool.id,
          },
          assistantContent: blocks,  // client echoes this back on confirm
        });
      }

      // Auto-execute all tool calls in this turn (none require confirm).
      const toolResults: any[] = [];
      for (const tu of toolUses) {
        const result = await executeTool(tu.name, tu.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }

      convo = [
        ...convo,
        { role: 'assistant', content: blocks },
        { role: 'user', content: toolResults },
      ];

      ({ ok, status, data, raw, timedOut } = await callAnthropic({
        ...baseBody,
        messages: convo,
      }, deadline));
      if (timedOut) {
        // Tools ran but we couldn't get the final summary in time. Return any
        // text from the previous turn so the reply isn't empty.
        return NextResponse.json({ content: extractText(blocks) || TIMEOUT_MESSAGE });
      }
      if (!ok || !data) {
        console.error('Anthropic tool-loop error:', data || raw.slice(0, 500));
        return NextResponse.json(
          { error: data?.error?.message || `Upstream error (${status})` },
          { status: status || 502 }
        );
      }
    }

    // Loop exhausted — return whatever text we have.
    return NextResponse.json({
      content: extractText(data?.content || []),
      error: 'Tool loop exceeded max iterations',
    });
  } catch (err: any) {
    console.error('Route error:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// =================================================================
// Helpers
// =================================================================

function extractText(blocks: any[]): string {
  return blocks
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
}

function buildClientResponse(blocks: any[]) {
  // No pending tools, but record any executed tool calls in the text we
  // return — the client uses this for the "Action confirmed" UI line.
  const executed = blocks
    .filter((b: any) => b.type === 'tool_use')
    .map((b: any) => ({ name: b.name, input: b.input }));
  return {
    content: extractText(blocks),
    executedTools: executed,  // empty array if none
  };
}

async function runConfirmedTool(opts: {
  pendingConfirm: { name: string; input: any; tool_use_id: string; assistant_content: any[] };
  messages: any[];
  systemPrompt: string;
  maxTokens?: number;
  model?: string;
  toolSchemas: any[];
  deadline: number;
}) {
  const { pendingConfirm, messages, systemPrompt, maxTokens, model, toolSchemas, deadline } = opts;

  // Execute the previously-deferred tool now that the user has confirmed.
  const result = await executeTool(pendingConfirm.name, pendingConfirm.input);

  // Stitch the conversation: original messages + the assistant turn that
  // contained the tool_use + a user turn containing the tool_result. Then
  // ask Claude to produce a natural-language closing message.
  const convo = [
    ...messages,
    { role: 'assistant', content: pendingConfirm.assistant_content },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: pendingConfirm.tool_use_id,
          content: JSON.stringify(result),
        },
      ],
    },
  ];

  const { ok, status, data, raw, timedOut } = await callAnthropic({
    model: model || 'claude-sonnet-4-6',
    max_tokens: maxTokens || CHAT_MAX_TOKENS,
    system: systemPrompt,
    messages: convo,
    tools: toolSchemas,
  }, deadline);
  // The tool already executed; if the closing summary times out, still tell
  // the client the action succeeded so the UI reflects it.
  if (timedOut) {
    return NextResponse.json({
      content: 'Done.',
      executedTools: [{ name: pendingConfirm.name, input: pendingConfirm.input }],
    });
  }
  if (!ok || !data) {
    console.error('Anthropic confirm error:', data || raw.slice(0, 500));
    return NextResponse.json(
      { error: data?.error?.message || `Upstream error (${status})` },
      { status: status || 502 }
    );
  }

  return NextResponse.json({
    content: extractText(data?.content || []),
    executedTools: [{ name: pendingConfirm.name, input: pendingConfirm.input }],
  });
}
