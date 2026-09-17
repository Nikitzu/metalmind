import { describe, expect, it } from 'vitest';
import { renderJudgeStatus } from './judge.js';

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
