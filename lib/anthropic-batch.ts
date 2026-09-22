/**
 * ANTHROPIC-BATCH-V1
 *
 * A thin, typed client for the Message Batches API — create, poll, fetch
 * results. Raw HTTP because this codebase calls Anthropic that way
 * everywhere (there is no SDK dependency), and the three endpoints are
 * small enough that adding one would be the larger change.
 *
 * Why batch a calendar fill at all: the synchronous fill is bounded by the
 * hosting platform's ~26s ceiling, so a 14-day fill takes roughly 21 browser
 * round-trips with the tab held open, and stops wherever the user closes it.
 * One batch is a single submission for the whole fill, at half the token
 * cost, with no tab to keep open.
 *
 * The cost of that is latency, and it is a real product change rather than a
 * free win: most batches finish within an hour, there is no faster
 * guarantee, and anything unfinished at 24 hours expires. That is a good
 * trade for a calendar being filled two weeks ahead and a bad one for "give
 * me a post now", which is why the synchronous path stays.
 */

/** Anthropic's own ceiling: 100,000 requests or 256 MB, whichever is first. */
export const MAX_BATCH_REQUESTS = 100_000;

/** custom_id must match this — 1-64 chars, alphanumeric, hyphen, underscore. */
export const CUSTOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const API_BASE = 'https://api.anthropic.com/v1/messages/batches';
const API_VERSION = '2023-06-01';

export interface BatchRequest {
  custom_id: string;
  /** A standard Messages API body: model, max_tokens, system, messages. */
  params: Record<string, unknown>;
}

export type BatchProcessingStatus = 'in_progress' | 'canceling' | 'ended';

export interface BatchStatus {
  id: string;
  processing_status: BatchProcessingStatus;
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  ended_at: string | null;
  expires_at: string | null;
  results_url: string | null;
}

export type BatchResultType = 'succeeded' | 'errored' | 'canceled' | 'expired';

export interface BatchResult {
  customId: string;
  type: BatchResultType;
  /** Response text, present only when type is 'succeeded'. */
  text?: string;
  /** Error type, present on 'errored'. */
  error?: string;
}

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
  };
}

/** Shape a non-2xx into an Error carrying enough of the body to debug from. */
async function raise(res: Response, what: string): Promise<never> {
  const detail = await res.text().catch(() => '');
  throw new Error(`${what} failed (${res.status}): ${detail.slice(0, 400)}`);
}

export async function createBatch(
  apiKey: string,
  requests: BatchRequest[],
  signal?: AbortSignal
): Promise<BatchStatus> {
  if (requests.length === 0) throw new Error('Refusing to submit an empty batch');
  if (requests.length > MAX_BATCH_REQUESTS) {
    throw new Error(`Batch of ${requests.length} exceeds the ${MAX_BATCH_REQUESTS} limit`);
  }
  const bad = requests.find(r => !CUSTOM_ID_PATTERN.test(r.custom_id));
  if (bad) throw new Error(`Invalid custom_id: ${JSON.stringify(bad.custom_id)}`);
  const seen = new Set<string>();
  for (const r of requests) {
    if (seen.has(r.custom_id)) throw new Error(`Duplicate custom_id: ${r.custom_id}`);
    seen.add(r.custom_id);
  }

  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ requests }),
    signal,
  });
  if (!res.ok) return raise(res, 'Batch create');
  return (await res.json()) as BatchStatus;
}

export async function getBatch(
  apiKey: string,
  batchId: string,
  signal?: AbortSignal
): Promise<BatchStatus> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(batchId)}`, {
    headers: headers(apiKey),
    signal,
  });
  if (!res.ok) return raise(res, 'Batch retrieve');
  return (await res.json()) as BatchStatus;
}

/**
 * Parse the JSONL results body.
 *
 * Kept pure and separate from the fetch so it can be tested against the
 * shapes that matter — a mixed batch of successes, errors and expiries —
 * without a live batch. Deliberately tolerant: a line that will not parse is
 * logged and skipped rather than failing the whole ingest, because the
 * alternative is one malformed row costing every caption in the job.
 */
export function parseResultsJsonl(body: string): BatchResult[] {
  const out: BatchResult[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: any;
    try {
      row = JSON.parse(trimmed);
    } catch {
      console.error('[batch] unparseable result line:', trimmed.slice(0, 200));
      continue;
    }
    const customId = row?.custom_id;
    const type = row?.result?.type;
    if (typeof customId !== 'string' || typeof type !== 'string') {
      console.error('[batch] result line missing custom_id or type:', trimmed.slice(0, 200));
      continue;
    }
    if (type === 'succeeded') {
      // Content is a block array; the caption is the first text block. A
      // response with no text block is a success with nothing in it, which
      // the caller must treat as a failed slot rather than an empty caption.
      const blocks: any[] = row?.result?.message?.content || [];
      const text = blocks.find(b => b?.type === 'text')?.text;
      out.push({ customId, type: 'succeeded', text: typeof text === 'string' ? text : undefined });
    } else {
      out.push({
        customId,
        type: type as BatchResultType,
        error: row?.result?.error?.type || row?.result?.error?.error?.type,
      });
    }
  }
  return out;
}

export async function fetchBatchResults(
  apiKey: string,
  resultsUrl: string,
  signal?: AbortSignal
): Promise<BatchResult[]> {
  const res = await fetch(resultsUrl, { headers: headers(apiKey), signal });
  if (!res.ok) return raise(res, 'Batch results');
  return parseResultsJsonl(await res.text());
}
