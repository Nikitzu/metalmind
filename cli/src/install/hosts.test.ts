import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectHosts, detectedAsList } from './hosts.js';

describe('detectHosts', () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'mm-hosts-'));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('returns false/false on empty home', () => {
    expect(detectHosts({ home: tmpHome })).toEqual({ claude: false, codex: false });
  });

  it('detects claude only', async () => {
    await mkdir(join(tmpHome, '.claude'), { recursive: true });
    expect(detectHosts({ home: tmpHome })).toEqual({ claude: true, codex: false });
  });

  it('detects codex only', async () => {
    await mkdir(join(tmpHome, '.codex'), { recursive: true });
    expect(detectHosts({ home: tmpHome })).toEqual({ claude: false, codex: true });
  });

  it('detects both', async () => {
    await mkdir(join(tmpHome, '.claude'), { recursive: true });
    await mkdir(join(tmpHome, '.codex'), { recursive: true });
    expect(detectHosts({ home: tmpHome })).toEqual({ claude: true, codex: true });
  });
});

describe('detectedAsList', () => {
  it('preserves claude-then-codex ordering', () => {
    expect(detectedAsList({ claude: true, codex: true })).toEqual(['claude', 'codex']);
    expect(detectedAsList({ claude: false, codex: true })).toEqual(['codex']);
    expect(detectedAsList({ claude: true, codex: false })).toEqual(['claude']);
    expect(detectedAsList({ claude: false, codex: false })).toEqual([]);
  });
});
