import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectObsidian } from './obsidian.js';

describe('detectObsidian', () => {
  let tmp: string;
  const savedHome = process.env.HOME;
  const savedAppData = process.env.APPDATA;
  const savedLocalAppData = process.env.LOCALAPPDATA;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-obsidian-'));
    process.env.HOME = tmp;
    // On Windows the env-var-driven candidates would otherwise leak host state.
    delete process.env.APPDATA;
    delete process.env.LOCALAPPDATA;
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    if (savedAppData !== undefined) process.env.APPDATA = savedAppData;
    if (savedLocalAppData !== undefined) process.env.LOCALAPPDATA = savedLocalAppData;
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns an install hint and never throws', async () => {
    const result = await detectObsidian();
    expect(typeof result.found).toBe('boolean');
    expect(result.installHint).toContain('obsidian');
  });

  it('detects a Linux config dir when present', async () => {
    if (process.platform !== 'linux') return;
    await mkdir(join(tmp, '.config', 'obsidian'), { recursive: true });
    const result = await detectObsidian();
    expect(result.found).toBe(true);
    expect(result.location).toContain('.config/obsidian');
  });

  it('detects a macOS Applications bundle in $HOME/Applications', async () => {
    if (process.platform !== 'darwin') return;
    await mkdir(join(tmp, 'Applications', 'Obsidian.app'), { recursive: true });
    const result = await detectObsidian();
    // /Applications/Obsidian.app may or may not exist on the host; we only assert
    // that one of the candidates resolved — either the host's or our fake.
    expect(result.found).toBe(true);
    expect(result.location).toMatch(/Obsidian\.app$/);
  });
});
