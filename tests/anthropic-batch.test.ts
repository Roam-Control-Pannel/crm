import type { T } from './harness';
import { parseResultsJsonl } from '@/lib/anthropic-batch';
import { postsFromResults } from '@/lib/fill-job';

const line = (customId: string, blocks: any[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    custom_id: customId,
    result: { type: 'succeeded', message: { content: blocks, stop_reason: 'end_turn', usage: { output_tokens: 20 }, ...extra } },
  });
const text = (t: string) => ({ type: 'text', text: t });

/** The reader as it was before this change: first text block only. */
const legacyFirstBlock = (blocks: any[]) => blocks.find(b => b?.type === 'text')?.text;

export async function run(t: T) {
  t.group('the scheduled batch path truncated captions split across blocks');
  {
    const blocks = [text('Walk the old harbour wall at low tide.'), text('\n\n#RoamLocal')];
    t.is('old reader kept only the first block',
      legacyFirstBlock(blocks), 'Walk the old harbour wall at low tide.');

    const [row] = parseResultsJsonl(line('slot-0', blocks));
    t.is('new reader keeps both', row.text, 'Walk the old harbour wall at low tide.\n\n#RoamLocal');
    t.is('and reports no error', row.error, undefined);
  }

  t.group('a success with nothing readable is a failed slot that says why');
  {
    const [noText] = parseResultsJsonl(JSON.stringify({
      custom_id: 'slot-1',
      result: { type: 'succeeded', message: { content: [], stop_reason: 'max_tokens', usage: { output_tokens: 800 } } },
    }));
    t.is('no caption', noText.text, undefined);
    t.match('names the cause and the remedy', noText.error!, /max_tokens limit before producing any text[\s\S]*raise maxTokens/);

    const [thinkingOnly] = parseResultsJsonl(line('slot-2', [{ type: 'thinking', thinking: 'hmm' }]));
    t.is('non-text blocks only: no caption', thinkingOnly.text, undefined);
    t.match('and says what it got', thinkingOnly.error!, /blocks: thinking/);
  }

  t.group('non-succeeded rows are unchanged');
  {
    const [errored] = parseResultsJsonl(JSON.stringify({
      custom_id: 'slot-3',
      result: { type: 'errored', error: { type: 'rate_limit_error' } },
    }));
    t.is('type', errored.type, 'errored');
    t.is('error type preserved', errored.error, 'rate_limit_error');
  }

  t.group('malformed lines are skipped, not fatal');
  {
    const rows = parseResultsJsonl(['{not json', '', line('slot-4', [text('ok')]), '{"no_custom_id":1}'].join('\n'));
    t.is('only the good row survives', rows.map(r => r.customId), ['slot-4']);
  }

  t.group('ingest carries the reasons instead of only a count');
  {
    const job: any = {
      id: 'j1', batchId: 'b1', status: 'submitted', createdAt: '', updatedAt: '',
      slots: [
        { customId: 'slot-0', accountId: 'a1', scheduledAt: '2026-11-01T10:00:00Z', briefId: 'b', themeId: 't' },
        { customId: 'slot-1', accountId: 'a1', scheduledAt: '2026-11-02T10:00:00Z', briefId: 'b', themeId: 't' },
      ],
      counts: { requested: 2, created: 0, failed: 0, skipped: 0 },
    };
    const outcome = postsFromResults(job, [
      { customId: 'slot-0', type: 'succeeded', text: '', error: 'the model hit its max_tokens limit' },
      { customId: 'slot-1', type: 'errored', error: 'rate_limit_error' },
    ], []);
    t.is('nothing written', outcome.created, 0);
    t.is('both counted as failed', outcome.failed, 2);
    t.is('and both reasons kept', outcome.errors, ['the model hit its max_tokens limit', 'rate_limit_error']);
  }

  t.group('identical reasons collapse, and a good caption still lands');
  {
    const slots = Array.from({ length: 5 }, (_, i) => ({
      customId: `slot-${i}`, accountId: 'a1', scheduledAt: `2026-11-0${i + 1}T10:00:00Z`, briefId: 'b', themeId: 't',
    }));
    const job: any = { id: 'j', batchId: 'b', status: 'submitted', createdAt: '', updatedAt: '', slots, counts: {} };
    const outcome = postsFromResults(job, [
      { customId: 'slot-0', type: 'succeeded', text: 'A real caption.' },
      ...slots.slice(1).map(s => ({ customId: s.customId, type: 'errored' as const, error: 'rate_limit_error' })),
    ], []);
    t.is('the good one is written', outcome.created, 1);
    t.is('the rest failed', outcome.failed, 4);
    t.is('four identical reasons say it once', outcome.errors, ['rate_limit_error']);
  }
}
