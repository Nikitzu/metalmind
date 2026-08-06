import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SymbolEntry } from '../forge/symbols.js';
import { findRepoRoot, matchSymbols } from './iron.js';

function sym(name: string, kind: SymbolEntry['kind'] = 'function'): SymbolEntry {
  return { name, kind, file: `/repo/${name}.ts`, line: 1, repo: '/repo' };
}

describe('matchSymbols', () => {
  const symbols = [sym('BookingService', 'class'), sym('Booking', 'interface'), sym('unrelated')];

  it('matches on substring by default', () => {
    expect(matchSymbols(symbols, 'booking', false).map((s) => s.name)).toEqual([
      'Booking',
      'BookingService',
    ]);
  });

  it('ranks an exact name above a longer substring match', () => {
    expect(matchSymbols(symbols, 'Booking', false)[0]?.name).toBe('Booking');
  });

  it('returns only the exact name when --exact is set', () => {
    expect(matchSymbols(symbols, 'Booking', true).map((s) => s.name)).toEqual(['Booking']);
  });

  it('returns nothing for an empty query rather than every symbol', () => {
    expect(matchSymbols(symbols, '   ', false)).toEqual([]);
  });
});

describe('findRepoRoot', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mm-iron-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('walks up to the nearest directory holding .git', async () => {
    const nested = join(tmp, 'a', 'b');
    await mkdir(nested, { recursive: true });
    await mkdir(join(tmp, '.git'), { recursive: true });
    expect(findRepoRoot(nested)).toBe(tmp);
  });

  it('returns null outside a repository', async () => {
    const nested = join(tmp, 'x');
    await mkdir(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBeNull();
  });
});

describe('burn iron end to end', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'mm-iron-repo-'));
    await mkdir(join(repo, '.git'), { recursive: true });
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('finds a declaration by walking the repo, with no external tool', async () => {
    await writeFile(
      join(repo, 'svc.ts'),
      'export class BookingService {}\nexport function createBooking() {}\n',
      'utf8',
    );
    const { extractSymbols } = await import('../forge/symbols.js');
    const hits = matchSymbols(await extractSymbols(repo), 'Booking', false);
    expect(hits.map((h) => [h.name, h.kind, h.line])).toEqual([
      ['BookingService', 'class', 1],
      ['createBooking', 'function', 2],
    ]);
  });
});
