import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendJudgeLog,
  entryFromResult,
  markOpenedAfterTap,
  readJudgeLog,
  updateJudgeLog,
} from './log.js';

describe('judge log', () => {
  it('records scores, confidence and files but never text', async () => {
    const entry = entryFromResult(
      {
        command: 'scribe-create',
        model: 'jev-1.13.0',
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
      { command: 'tap', model: 'jev-1.13.0', latency_ms: 10, decision: 'unjudged' },
      { answers: null, unjudged: 'rejected', status: 401 },
      {},
    );
    expect(entry.unjudged).toBe('rejected 401');
    expect(entry.answers).toEqual([]);
  });
});

describe('labels and opened', () => {
  it('updates entries in place and marks the last recent tap as opened', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mm-judge-'));
    const path = join(dir, 'judge-log.jsonl');
    const tap = entryFromResult(
      { command: 'tap', model: 'm', latency_ms: 1, decision: 'kept 1 of 2' },
      { answers: { h0: { type: 'score', score: 1.8, confidence: 0.9, probabilities: {} } } },
      { h0: 'Work/a.md' },
    );
    await appendJudgeLog(tap, path);
    expect(await markOpenedAfterTap('Work/a.md', path)).toBe(true);
    expect(await markOpenedAfterTap('Work/a.md', path)).toBe(false);
    const changed = await updateJudgeLog((e) => ({ ...e, label: 'right' }), path);
    expect(changed).toBe(1);
    const [entry] = await readJudgeLog(path);
    expect(entry?.opened).toEqual(['Work/a.md']);
    expect(entry?.label).toBe('right');
  });
});
