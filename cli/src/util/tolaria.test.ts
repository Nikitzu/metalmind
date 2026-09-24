import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectTolaria } from './tolaria.js';

describe('detectTolaria', () => {
  let tmp: string;
  const savedHome = process.env.HOME;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-tolaria-'));
    process.env.HOME = tmp;
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns an install hint and never throws', async () => {
    const result = await detectTolaria();
    expect(typeof result.found).toBe('boolean');
    expect(result.installHint).toContain('tolaria');
  });

  it('detects the app config dir when present', async () => {
    if (process.platform === 'win32') return;
    await mkdir(join(tmp, '.config', 'com.tolaria.app'), { recursive: true });
    const result = await detectTolaria();
    expect(result.found).toBe(true);
    expect(result.location).toContain('com.tolaria.app');
  });
});
