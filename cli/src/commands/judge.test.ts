import { describe, expect, it } from 'vitest';
import { renderJudgeReport, renderJudgeStatus } from './judge.js';

describe('renderJudgeStatus', () => {
  it('reports enabled, key source and model without the key', () => {
    const text = renderJudgeStatus(
      { enabled: true, model: 'jev-latest' },
      { key: 'secret-value', source: 'keychain' },
    );
    expect(text).toContain('enabled: yes');
    expect(text).toContain('key: keychain (typesafe-api-key)');
    expect(text).toContain('model: jev-latest');
    expect(text).not.toContain('secret-value');
  });
  it('says how to enable when off', () => {
    const text = renderJudgeStatus(
      { enabled: false, model: 'jev-latest' },
      { key: null, source: 'none' },
    );
    expect(text).toContain('enabled: no');
    expect(text).toContain('key: none');
    expect(text).toContain('metalmind judge enable');
  });
});

describe('renderJudgeReport', () => {
  const now = new Date().toISOString();
  it('counts refusals, overrides, kept ratio, unjudged and cost', () => {
    const text = renderJudgeReport(
      [
        {
          ts: now,
          command: 'scribe-create',
          model: 'jev-latest',
          latency_ms: 300,
          decision: 'refused Work/a.md',
          answers: [{ id: 'c0', score: 1.8, confidence: 0.9, probabilities: {} }],
          usage: { input_tokens: 500, output_tokens: 2 },
        },
        {
          ts: now,
          command: 'scribe-create',
          model: 'jev-latest',
          latency_ms: 200,
          decision: 'refused Work/a.md',
          forced: true,
          answers: [{ id: 'c0', score: 1.6, confidence: 0.7, probabilities: {} }],
        },
        {
          ts: now,
          command: 'tap',
          model: 'jev-latest',
          latency_ms: 400,
          decision: 'kept 4 of 10',
          answers: [],
          usage: { input_tokens: 1500, output_tokens: 10 },
        },
        {
          ts: now,
          command: 'tap',
          model: 'jev-latest',
          latency_ms: 5,
          decision: 'unjudged',
          unjudged: 'offline',
          answers: [],
        },
      ],
      7,
    );
    expect(text).toContain('4 calls');
    expect(text).toContain('scribe: 2 judged, 2 refused, 1 forced through');
    expect(text).toContain('tap: 2 judged, mean kept 40%');
    expect(text).toContain('unjudged: 1 (offline)');
    expect(text).toContain('input tokens: 2000');
    expect(text).toContain('latency: p50');
    expect(text).toContain('labels: 0 of 4 reviewed');
  });
  it('turns labels into precision per decision and band', () => {
    const text = renderJudgeReport(
      [
        {
          ts: now,
          command: 'scribe-create',
          model: 'm',
          latency_ms: 1,
          decision: 'refused Work/a.md',
          label: 'right',
          answers: [
            { id: 'c0', file: 'Work/a.md', score: 1.8, confidence: 0.9, probabilities: {} },
          ],
        },
        {
          ts: now,
          command: 'scribe-create',
          model: 'm',
          latency_ms: 1,
          decision: 'refused Work/b.md',
          label: 'wrong',
          answers: [
            { id: 'c0', file: 'Work/b.md', score: 1.6, confidence: 0.7, probabilities: {} },
          ],
        },
        {
          ts: now,
          command: 'tap',
          model: 'm',
          latency_ms: 1,
          decision: 'kept 2 of 10',
          opened: ['Work/c.md'],
          answers: [
            { id: 'h0', file: 'Work/c.md', score: 1.9, confidence: 0.9, probabilities: {} },
          ],
        },
      ],
      7,
    );
    expect(text).toContain('refusals 1/2 right (50%)');
    expect(text).toContain('1.5+ / conf 0.8+: 1/1 right');
    expect(text).toContain('1.5+ / conf 0.6-0.8: 0/1 right');
    expect(text).toContain('opened after recall: 1 taps, top judged hit opened in 1');
  });
  it('says so when the log is empty', () => {
    expect(renderJudgeReport([], 7)).toContain('no judge calls');
  });
});
