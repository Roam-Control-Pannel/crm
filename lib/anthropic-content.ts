// ANTHROPIC-CONTENT-V1
//
// Reading text out of a Messages API response, and saying something useful
// when there is none.
//
// A response body carries `content` as an ARRAY of blocks, not a string. Most
// of the time it is a single text block, which is why `content[0].text` looks
// like it works and then quietly doesn't: a response whose first block is not
// a text block yields undefined, and one whose text is split across blocks
// loses everything after the first. Both come back to the caller as an empty
// string with no explanation.
//
// That is exactly what happened on the caption path. /api/ai/chat had a
// correct helper and used it on every branch but one — the branch the fill
// runs through. Keeping the reader here, in one dep-free place, is what stops
// the next caller hand-rolling it again.

/** Every text block in the response, joined. Non-text blocks are skipped. */
export function extractText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
}

/**
 * Why a response carried no text, in words the person who clicked the button
 * can act on.
 *
 * "Empty response" is not a diagnosis — it is the absence of one, and it sent
 * us hunting through function logs. The API always says what it did: a
 * stop_reason, the blocks it produced, and how many tokens it spent. Say that
 * instead, and name the remedy where there is one.
 */
export function describeEmptyResponse(data: any): string {
  const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
  const stop = data?.stop_reason || 'unknown';
  const outputTokens = data?.usage?.output_tokens ?? 0;
  const kinds = blocks.length
    ? Array.from(new Set(blocks.map((b: any) => b?.type || 'unknown'))).join(', ')
    : 'none';

  if (stop === 'max_tokens') {
    return 'the model hit its max_tokens limit before producing any text '
      + `(${outputTokens} output tokens, blocks: ${kinds}) — raise maxTokens for this call`;
  }
  if (stop === 'refusal') {
    return 'the model declined to write this one (stop_reason: refusal)';
  }
  return `the model returned no text (stop_reason: ${stop}, blocks: ${kinds}, `
    + `output tokens: ${outputTokens})`;
}
