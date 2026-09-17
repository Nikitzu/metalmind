import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clipForState, judge, judgeEnabled, resolveJudgeKey } from './client.js';

describe('resolveJudgeKey', () => {
  const env = process.env.TYPESAFE_API_KEY;
  afterEach(() => {
    if (env === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = env;
  });

  it('prefers the environment variable', async () => {
    process.env.TYPESAFE_API_KEY = 'env-key';
    const keychain = vi.fn(async () => 'kc-key');
    await expect(resolveJudgeKey({ keychain })).resolves.toEqual({ key: 'env-key', source: 'env' });
    expect(keychain).not.toHaveBeenCalled();
  });

  it('falls back to the keychain', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const keychain = vi.fn(async () => ' kc-key\n');
    await expect(resolveJudgeKey({ keychain })).resolves.toEqual({
      key: 'kc-key',
      source: 'keychain',
    });
  });

  it('reports none when both are empty', async () => {
    delete process.env.TYPESAFE_API_KEY;
    await expect(resolveJudgeKey({ keychain: async () => '' })).resolves.toEqual({
      key: null,
      source: 'none',
    });
  });
});

describe('judgeEnabled', () => {
  const env = process.env.METALMIND_JUDGE;
  afterEach(() => {
    if (env === undefined) delete process.env.METALMIND_JUDGE;
    else process.env.METALMIND_JUDGE = env;
  });

  it('is false when config disables it', () => {
    expect(judgeEnabled({ enabled: false, model: 'jev-latest' })).toBe(false);
  });
  it('is false when METALMIND_JUDGE=0 even if config enables it', () => {
    process.env.METALMIND_JUDGE = '0';
    expect(judgeEnabled({ enabled: true, model: 'jev-latest' })).toBe(false);
  });
  it('is true when config enables it and the env is unset', () => {
    delete process.env.METALMIND_JUDGE;
    expect(judgeEnabled({ enabled: true, model: 'jev-latest' })).toBe(true);
  });
});

describe('clipForState', () => {
  it('strips frontmatter and caps at 2000 characters', () => {
    const body = `---\nkind: work\ntitle: x\n---\n${'a'.repeat(3000)}`;
    const out = clipForState(body);
    expect(out.startsWith('aaa')).toBe(true);
    expect(out.length).toBe(2000);
  });
  it('leaves a body without frontmatter alone', () => {
    expect(clipForState('plain body')).toBe('plain body');
  });
});

describe('judge', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.TYPESAFE_API_KEY = 'k';
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.TYPESAFE_API_KEY;
  });

  const questions = { q: { type: 'noul' as const, instructions: 'is it' } };

  it('returns no-key without calling out', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await judge({
      state: 's',
      questions,
      model: 'jev-latest',
      keychain: async () => '',
    });
    expect(res).toEqual({ answers: null, unjudged: 'no-key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends bearer auth, model, state and questions and returns answers with usage', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: { q: { type: 'noul', noul: 0.8 } },
        usage: { input_tokens: 12, output_tokens: 1 },
      }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await judge({ state: 's', questions, model: 'jev-latest' });
    expect(res.answers).toEqual({ q: { type: 'noul', noul: 0.8 } });
    expect(res.usage).toEqual({ input_tokens: 12, output_tokens: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'jev-latest', state: 's', questions });
  });

  it.each([
    [401, 'rejected'],
    [422, 'rejected'],
    [429, 'rejected'],
    [529, 'rejected'],
  ])('maps HTTP %s to %s with the status', async (status, reason) => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const res = await judge({ state: 's', questions, model: 'jev-latest' });
    expect(res).toEqual({ answers: null, unjudged: reason, status });
  });

  it('maps a network error to offline', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const res = await judge({ state: 's', questions, model: 'jev-latest' });
    expect(res).toEqual({ answers: null, unjudged: 'offline' });
  });

  it('maps an abort to timeout', async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    const res = await judge({ state: 's', questions, model: 'jev-latest' });
    expect(res).toEqual({ answers: null, unjudged: 'timeout' });
  });
});
