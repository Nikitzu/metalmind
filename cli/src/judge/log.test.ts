import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendJudgeLog, entryFromResult, readJudgeLog } from './log.js';

describe('judge log', () => {
  it('records scores, confidence and files but never text', async () => {
    const entry = entryFromResult(
      {
        command: 'scribe-create',
        model: 'jev-latest',
        latency_ms: 321,
        decision: 'refused Work/a.md',
      },
      {
        answers: {
          c0: { type: 'score', score: 1.7, confidence: 0.9, probabilities: { '2': 0.8 } },
        },
        usage: { input_tokens: 400, output_tokens: 3 },
      },
      { c0: 'Work/a.md' },
    );
    expect(entry.answers).toEqual([
      { id: 'c0', file: 'Work/a.md', score: 1.7, confidence: 0.9, probabilities: { '2': 0.8 } },
    ]);
    expect(JSON.stringify(entry)).not.toContain('body');
    const dir = await mkdtemp(join(tmpdir(), 'mm-judge-'));
    const path = join(dir, 'judge-log.jsonl');
    await appendJudgeLog(entry, path);
    await appendJudgeLog(entry, path);
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(2);
    expect(await readJudgeLog(path)).toHaveLength(2);
  });
  it('keeps the unjudged reason with its status', () => {
    const entry = entryFromResult(
      { command: 'tap', model: 'jev-latest', latency_ms: 10, decision: 'unjudged' },
      { answers: null, unjudged: 'rejected', status: 401 },
      {},
    );
    expect(entry.unjudged).toBe('rejected 401');
    expect(entry.answers).toEqual([]);
  });
});
