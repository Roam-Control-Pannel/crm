import type { T } from './harness';
import { extractText, describeEmptyResponse } from '@/lib/anthropic-content';

/** The reader as it was on the caption path before ANTHROPIC-CONTENT-V1. */
const legacyRead = (data: any) => data?.content?.[0]?.text || '';
const text = (t: string) => ({ type: 'text', text: t });

export async function run(t: T) {
  t.group('responses the old reader threw away');
  {
    const split = { content: [text('Line one.'), text('Line two.')] };
    t.is('text split across blocks: old reader loses the rest', legacyRead(split), 'Line one.');
    t.is('text split across blocks: new reader concatenates them, inventing no whitespace',
      extractText(split.content), 'Line one.Line two.');

    const leading = { content: [{ type: 'thinking', thinking: 'hmm' }, text('The caption.')] };
    t.is('non-text block first: old reader returns nothing', legacyRead(leading), '');
    t.is('non-text block first: new reader finds the text', extractText(leading.content), 'The caption.');

    const emptyFirst = { content: [text(''), text('The caption.')] };
    t.is('empty first block: old reader returns nothing', legacyRead(emptyFirst), '');
    t.is('empty first block: new reader finds the text', extractText(emptyFirst.content), 'The caption.');
  }

  t.group('the ordinary single-block case is unchanged');
  {
    t.is('trims', extractText([text('  A caption.  ')]), 'A caption.');
    t.is('identical to the old reader', extractText([text('A caption.')]), legacyRead({ content: [text('A caption.')] }));
  }

  t.group('malformed or absent content never throws');
  {
    t.is('content missing', extractText(undefined), '');
    t.is('content not an array', extractText('a string'), '');
    t.is('empty array', extractText([]), '');
    t.is('block with no text field', extractText([{ type: 'text' }]), '');
    t.is('null block among good ones', extractText([null, text('ok')]), 'ok');
  }

  t.group('a genuinely empty response says why');
  {
    t.is('max_tokens names the remedy',
      describeEmptyResponse({ content: [], stop_reason: 'max_tokens', usage: { output_tokens: 800 } }),
      'the model hit its max_tokens limit before producing any text (800 output tokens, blocks: none) — raise maxTokens for this call');
    t.is('refusal',
      describeEmptyResponse({ content: [], stop_reason: 'refusal' }),
      'the model declined to write this one (stop_reason: refusal)');
    t.is('no blocks at all',
      describeEmptyResponse({ content: [], stop_reason: 'end_turn', usage: { output_tokens: 0 } }),
      'the model returned no text (stop_reason: end_turn, blocks: none, output tokens: 0)');
    t.is('only non-text blocks',
      describeEmptyResponse({ content: [{ type: 'thinking' }], stop_reason: 'end_turn', usage: { output_tokens: 12 } }),
      'the model returned no text (stop_reason: end_turn, blocks: thinking, output tokens: 12)');
    t.is('nothing known', describeEmptyResponse({}),
      'the model returned no text (stop_reason: unknown, blocks: none, output tokens: 0)');
    t.is('garbage in', describeEmptyResponse(null),
      'the model returned no text (stop_reason: unknown, blocks: none, output tokens: 0)');
  }
}
