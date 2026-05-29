import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectedAsList, detectHosts } from './hosts.js';

describe('detectHosts', () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'mm-hosts-'));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('returns all false on empty home', () => {
    expect(detectHosts({ home: tmpHome })).toEqual({
      claude: false,
      codex: false,
      cursor: false,
    });
  });

  it('detects claude only', async () => {
    await mkdir(join(tmpHome, '.claude'), { recursive: true });
    expect(detectHosts({ home: tmpHome })).toEqual({
      claude: true,
      codex: false,
      cursor: false,
    });
  });

  it('detects codex only', async () => {
    await mkdir(join(tmpHome, '.codex'), { recursive: true });
    expect(detectHosts({ home: tmpHome })).toEqual({
      claude: false,
      codex: true,
      cursor: false,
    });
  });

  it('detects cursor only', async () => {
    await mkdir(join(tmpHome, '.cursor'), { recursive: true });
    expect(detectHosts({ home: tmpHome })).toEqual({
      claude: false,
      codex: false,
      cursor: true,
    });
  });

  it('detects all three', async () => {
    await mkdir(join(tmpHome, '.claude'), { recursive: true });
    await mkdir(join(tmpHome, '.codex'), { recursive: true });
    await mkdir(join(tmpHome, '.cursor'), { recursive: true });
    expect(detectHosts({ home: tmpHome })).toEqual({
      claude: true,
      codex: true,
      cursor: true,
    });
  });
});

describe('detectedAsList', () => {
  it('preserves claude-then-codex-then-cursor ordering', () => {
    expect(detectedAsList({ claude: true, codex: true, cursor: true })).toEqual([
      'claude',
      'codex',
      'cursor',
    ]);
    expect(detectedAsList({ claude: false, codex: true, cursor: false })).toEqual(['codex']);
    expect(detectedAsList({ claude: true, codex: false, cursor: true })).toEqual([
      'claude',
      'cursor',
    ]);
    expect(detectedAsList({ claude: false, codex: false, cursor: false })).toEqual([]);
  });
});
