import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';

function baseConfig(): Config {
  return {
    version: 1,
    flavor: 'scadrial',
    vaultPath: '/v',
    graphifyCmd: 'graphify',
    outputStyle: { installed: 'marsh', priorValue: null },
    embeddings: { provider: 'local', baseURL: null },
    recall: { defaultTier: 'fast' },
    verbose: false,
    mcp: { registered: ['vault-rag'] },
    hooks: { claudeCode: false },
    forge: { groups: {} },
  };
}

describe('forge store', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-forge-'));
    vi.resetModules();
    vi.doMock('node:os', async (orig) => ({
      ...(await orig<typeof import('node:os')>()),
      homedir: () => tmp,
    }));
    const { writeConfig } = await import('../config.js');
    await writeConfig(baseConfig());
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
    vi.resetModules();
  });

  it('createForge writes a new empty group', async () => {
    const { createForge, listForges } = await import('./store.js');
    await createForge('my-stack');
    const groups = await listForges();
    expect(groups['my-stack']).toEqual({ repos: [] });
  });

  it('createForge rejects duplicates', async () => {
    const { createForge } = await import('./store.js');
    await createForge('dup');
    await expect(createForge('dup')).rejects.toThrow(/already exists/);
  });

  it('addRepoToForge appends and rejects duplicates', async () => {
    const { createForge, addRepoToForge, listForges } = await import('./store.js');
    await createForge('g');
    await addRepoToForge('g', '/Users/me/app-a');
    await addRepoToForge('g', '/Users/me/app-b');
    await expect(addRepoToForge('g', '/Users/me/app-a')).rejects.toThrow(/already in forge/);
    const groups = await listForges();
    expect(groups.g?.repos).toEqual(['/Users/me/app-a', '/Users/me/app-b']);
  });

  it('removeRepoFromForge removes and reports missing', async () => {
    const { createForge, addRepoToForge, removeRepoFromForge, listForges } = await import(
      './store.js'
    );
    await createForge('g');
    await addRepoToForge('g', '/r1');
    await removeRepoFromForge('g', '/r1');
    const groups = await listForges();
    expect(groups.g?.repos).toEqual([]);
    await expect(removeRepoFromForge('g', '/r1')).rejects.toThrow(/not in forge/);
  });

  it('deleteForge removes the group', async () => {
    const { createForge, deleteForge, listForges } = await import('./store.js');
    await createForge('g');
    await deleteForge('g');
    const groups = await listForges();
    expect(groups.g).toBeUndefined();
  });

  it('getForge throws when missing', async () => {
    const { getForge } = await import('./store.js');
    await expect(getForge('nope')).rejects.toThrow(/not found/);
  });
});
