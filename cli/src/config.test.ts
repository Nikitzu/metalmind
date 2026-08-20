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
      version: 5,
      flavor: 'scadrial',
      vaultPath: '/tmp/vault',
      outputStylePriorValue: null,
      embeddings: { provider: 'local', baseURL: null },
      recall: { defaultTier: 'fast', httpEndpoint: null },
      verbose: false,
      mcp: { registered: ['vault-rag'] },
      hooks: { claudeCode: true },
      forge: { groups: {} },
      memoryRouting: 'vault-only',
      skills: { eodHook: true, notifications: true },
      hosts: ['claude'],
      install: { profile: 'full', teams: true },
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
      version: 3,
      flavor: 'classic',
      vaultPath: '/tmp/vault',
      outputStylePriorValue: null,
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

  it('a v1 config drops graphify and is rewritten to disk, so no stale keys survive', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    const v1 = {
      version: 1,
      flavor: 'scadrial',
      vaultPath: '/tmp/vault',
      graphifyCmd: 'graphify',
      outputStylePriorValue: null,
      embeddings: { provider: 'local', baseURL: null },
      recall: { defaultTier: 'fast', httpEndpoint: null },
      verbose: false,
      mcp: { registered: ['serena', 'graphify'] },
      hooks: { claudeCode: true },
      forge: { groups: {} },
      memoryRouting: 'vault-only',
      skills: { eodHook: true, notifications: true },
      hosts: ['claude'],
    };
    const path = join(tmp, '.metalmind', 'config.json');
    await writeFile(path, JSON.stringify(v1), 'utf8');

    const { readConfig } = await import('./config.js');
    const loaded = await readConfig();
    expect(loaded?.version).toBe(5);
    expect(loaded?.mcp.registered).toEqual(['serena']);
    expect(loaded?.hooks.claudeCode).toBe(false);
    expect(loaded).not.toHaveProperty('graphifyCmd');

    const onDisk = JSON.parse(await readFile(path, 'utf8'));
    expect(onDisk.version).toBe(5);
    expect(onDisk).not.toHaveProperty('graphifyCmd');
    expect(onDisk.mcp.registered).toEqual(['serena']);
  });

  it('preserves unrelated settings across the v1 migration, but retires the ollama provider', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    const v1 = {
      version: 1,
      flavor: 'classic',
      vaultPath: '/custom/vault',
      graphifyCmd: 'graphify',
      outputStyle: { installed: 'telegraph', priorValue: 'explanatory' },
      embeddings: { provider: 'ollama', baseURL: 'http://localhost:11434' },
      recall: { defaultTier: 'deep', httpEndpoint: 'http://127.0.0.1:17317' },
      verbose: true,
      mcp: { registered: ['serena'] },
      hooks: { claudeCode: false },
      forge: { groups: { shop: { repos: ['/a', '/b'] } } },
      memoryRouting: 'both',
      skills: { eodHook: false, notifications: false },
      hosts: ['claude', 'codex'],
    };
    await writeFile(join(tmp, '.metalmind', 'config.json'), JSON.stringify(v1), 'utf8');

    const { readConfig } = await import('./config.js');
    const loaded = await readConfig();
    expect(loaded?.vaultPath).toBe('/custom/vault');
    expect(loaded?.forge.groups).toEqual({ shop: { repos: ['/a', '/b'] } });
    expect(loaded?.recall.defaultTier).toBe('deep');
    // v2 to v3 retires the Ollama embedding provider; a stale baseURL must go
    // with it, or the config would name a daemon nothing talks to.
    expect(loaded?.embeddings.provider).toBe('local');
    expect(loaded?.embeddings.baseURL).toBeNull();
    expect(loaded?.hosts).toEqual(['claude', 'codex']);
    expect(loaded?.verbose).toBe(true);
    // v4 to v5 drops the retired output-style object but keeps the value the
    // cleanup needs to put settings.outputStyle back where it found it.
    expect(loaded?.version).toBe(5);
    expect(loaded?.outputStylePriorValue).toBe('explanatory');
    expect((loaded as unknown as Record<string, unknown>).outputStyle).toBeUndefined();
  });

  it('drops the output-style object at v5 with no prior value to keep', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    const v4 = {
      version: 4,
      flavor: 'scadrial',
      vaultPath: '/custom/vault',
      outputStyle: { installed: 'marsh', priorValue: null },
      embeddings: { provider: 'local', baseURL: null },
      recall: { defaultTier: 'fast', httpEndpoint: null },
      verbose: false,
      mcp: { registered: [] },
      hooks: { claudeCode: true },
      forge: { groups: {} },
      memoryRouting: 'vault-only',
      skills: { eodHook: true, notifications: true },
      hosts: ['claude'],
      install: { profile: 'full', teams: false },
    };
    await writeFile(join(tmp, '.metalmind', 'config.json'), JSON.stringify(v4), 'utf8');

    const { readConfig } = await import('./config.js');
    const loaded = await readConfig();
    expect(loaded?.version).toBe(5);
    expect(loaded?.outputStylePriorValue).toBeNull();
    expect((loaded as unknown as Record<string, unknown>).outputStyle).toBeUndefined();
  });

  it('round-trips hosts ["claude", "codex"]', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    const { readConfig, writeConfig } = await import('./config.js');
    const cfg: Config = {
      version: 5,
      flavor: 'classic',
      vaultPath: '/tmp/vault',
      outputStylePriorValue: null,
      embeddings: { provider: 'local', baseURL: null },
      recall: { defaultTier: 'fast', httpEndpoint: null },
      verbose: false,
      mcp: { registered: [] },
      hooks: { claudeCode: true },
      forge: { groups: {} },
      memoryRouting: 'vault-only',
      skills: { eodHook: true, notifications: true },
      hosts: ['claude', 'codex'],
      install: { profile: 'core', teams: false },
    };
    await writeConfig(cfg);
    const loaded = await readConfig();
    expect(loaded?.hosts).toEqual(['claude', 'codex']);
  });

  it('a config from a newer metalmind says upgrade, not a zod dump', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    await writeFile(
      join(tmp, '.metalmind', 'config.json'),
      JSON.stringify({ version: 99, flavor: 'scadrial', vaultPath: '/tmp/vault' }),
      'utf8',
    );
    const { readConfig } = await import('./config.js');
    await expect(readConfig()).rejects.toThrow(/only understands|upgrade/i);
  });

  it('rejects empty hosts array', async () => {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    const bad = {
      version: 3,
      flavor: 'classic',
      vaultPath: '/tmp/vault',
      outputStylePriorValue: null,
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

describe('config v3 → v4 install manifest migration', () => {
  let tmp: string;

  beforeEach(async () => {
    vi.resetModules();
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-config-v4-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
    vi.doUnmock('node:os');
  });

  const v3 = {
    version: 3,
    flavor: 'scadrial',
    vaultPath: '/tmp/vault',
    outputStylePriorValue: null,
    embeddings: { provider: 'local', baseURL: null },
    recall: { defaultTier: 'fast', httpEndpoint: null },
    verbose: false,
    mcp: { registered: [] },
    hooks: { claudeCode: false },
    forge: { groups: {} },
    memoryRouting: 'vault-only',
    skills: { eodHook: true, notifications: true },
    hosts: ['claude'],
  };

  async function loadWithHome(): Promise<typeof import('./config.js')> {
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    return import('./config.js');
  }

  it('a full+teams machine is inferred from synod and team commands on disk', async () => {
    await mkdir(join(tmp, '.claude', 'skills', 'synod'), { recursive: true });
    await mkdir(join(tmp, '.claude', 'commands'), { recursive: true });
    await writeFile(join(tmp, '.claude', 'commands', 'team-debug.md'), 'x', 'utf8');
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    await writeFile(join(tmp, '.metalmind', 'config.json'), JSON.stringify(v3), 'utf8');

    const { readConfig } = await loadWithHome();
    const cfg = await readConfig();

    expect(cfg?.version).toBe(5);
    expect(cfg?.install).toEqual({ profile: 'full', teams: true });
  });

  it('a core-shaped machine is inferred as core without teams', async () => {
    await mkdir(join(tmp, '.claude', 'skills', 'metalmind-cli'), { recursive: true });
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    await writeFile(join(tmp, '.metalmind', 'config.json'), JSON.stringify(v3), 'utf8');

    const { readConfig } = await loadWithHome();
    const cfg = await readConfig();

    expect(cfg?.install).toEqual({ profile: 'core', teams: false });
  });

  it('the migration is written back to disk', async () => {
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    await writeFile(join(tmp, '.metalmind', 'config.json'), JSON.stringify(v3), 'utf8');

    const { readConfig } = await loadWithHome();
    await readConfig();

    const onDisk = JSON.parse(await readFile(join(tmp, '.metalmind', 'config.json'), 'utf8'));
    expect(onDisk.version).toBe(5);
    expect(onDisk.install).toBeDefined();
  });
});
