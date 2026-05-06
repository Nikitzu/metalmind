import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
      recall: { defaultTier: 'fast', httpEndpoint: null },
      verbose: false,
      mcp: { registered: ['vault-rag'] },
      hooks: { claudeCode: true },
      forge: { groups: {} },
      memoryRouting: 'vault-only',
      skills: { eodHook: true, notifications: true },
      hosts: ['claude'],
    };

    await writeConfig(cfg);
    const written = await readFile(join(tmp, '.metalmind', 'config.json'), 'utf8');
    expect(JSON.parse(written)).toEqual(cfg);

    const loaded = await readConfig();
    expect(loaded).toEqual(cfg);
  });

  it('legacy config without hosts field migrates to ["claude"]', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    // Construct a v0.7.x-shaped config: every required field except hosts.
    const legacy = {
      version: 1,
      flavor: 'classic',
      vaultPath: '/tmp/vault',
      graphifyCmd: 'graphify',
      outputStyle: { installed: null, priorValue: null },
      embeddings: { provider: 'local', baseURL: null },
      recall: { defaultTier: 'fast', httpEndpoint: null },
      verbose: false,
      mcp: { registered: [] },
      hooks: { claudeCode: true },
      forge: { groups: {} },
      memoryRouting: 'vault-only',
      skills: { eodHook: true, notifications: true },
    };
    await writeFile(join(tmp, '.metalmind', 'config.json'), JSON.stringify(legacy), 'utf8');
    const { readConfig } = await import('./config.js');
    const loaded = await readConfig();
    expect(loaded?.hosts).toEqual(['claude']);
  });

  it('round-trips hosts ["claude", "codex"]', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    const { readConfig, writeConfig } = await import('./config.js');
    const cfg: Config = {
      version: 1,
      flavor: 'classic',
      vaultPath: '/tmp/vault',
      graphifyCmd: 'graphify',
      outputStyle: { installed: null, priorValue: null },
      embeddings: { provider: 'local', baseURL: null },
      recall: { defaultTier: 'fast', httpEndpoint: null },
      verbose: false,
      mcp: { registered: [] },
      hooks: { claudeCode: true },
      forge: { groups: {} },
      memoryRouting: 'vault-only',
      skills: { eodHook: true, notifications: true },
      hosts: ['claude', 'codex'],
    };
    await writeConfig(cfg);
    const loaded = await readConfig();
    expect(loaded?.hosts).toEqual(['claude', 'codex']);
  });

  it('rejects empty hosts array', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    const bad = {
      version: 1,
      flavor: 'classic',
      vaultPath: '/tmp/vault',
      graphifyCmd: 'graphify',
      outputStyle: { installed: null, priorValue: null },
      embeddings: { provider: 'local', baseURL: null },
      recall: { defaultTier: 'fast', httpEndpoint: null },
      verbose: false,
      mcp: { registered: [] },
      hooks: { claudeCode: true },
      forge: { groups: {} },
      memoryRouting: 'vault-only',
      skills: { eodHook: true, notifications: true },
      hosts: [],
    };
    await writeFile(join(tmp, '.metalmind', 'config.json'), JSON.stringify(bad), 'utf8');
    const { readConfig } = await import('./config.js');
    await expect(readConfig()).rejects.toThrow();
  });

  it('readConfig throws on malformed JSON', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    await writeFile(join(tmp, '.metalmind', 'config.json'), '{ not json', 'utf8');
    const { readConfig } = await import('./config.js');
    await expect(readConfig()).rejects.toThrow();
  });

  it('readConfig throws on schema violation', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    await writeFile(
      join(tmp, '.metalmind', 'config.json'),
      JSON.stringify({ version: 1, flavor: 'bogus' }),
      'utf8',
    );
    const { readConfig } = await import('./config.js');
    await expect(readConfig()).rejects.toThrow();
  });
});
