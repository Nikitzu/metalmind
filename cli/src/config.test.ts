import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from './config.js';

describe('config', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-test-'));
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('readConfig returns null when file is missing', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    const { readConfig } = await import('./config.js');
    expect(await readConfig()).toBeNull();
  });

  it('writeConfig then readConfig round-trips', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    const { readConfig, writeConfig } = await import('./config.js');

    const cfg: Config = {
      version: 1,
      flavor: 'scadrial',
      vaultPath: '/tmp/vault',
      graphifyCmd: 'graphify',
      outputStyle: { installed: 'marsh', priorValue: null },
      embeddings: { provider: 'local', baseURL: null },
      recall: { defaultTier: 'fast' },
      mcp: { registered: ['vault-rag'] },
      hooks: { claudeCode: true },
      forge: { groups: {} },
    };

    await writeConfig(cfg);
    const written = await readFile(join(tmp, '.metalmind', 'config.json'), 'utf8');
    expect(JSON.parse(written)).toEqual(cfg);

    const loaded = await readConfig();
    expect(loaded).toEqual(cfg);
  });
});
