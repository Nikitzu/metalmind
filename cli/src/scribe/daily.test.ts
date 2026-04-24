import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dailyAdd, dailyNew, extractUncheckedItems, resolveDate } from './daily.js';

const tueMidday = () => new Date('2026-04-21T12:00:00.000Z');
const friMidday = () => new Date('2026-04-24T12:00:00.000Z');

describe('resolveDate', () => {
  it('returns today for default', () => {
    expect(resolveDate(undefined, tueMidday())).toBe('2026-04-21');
    expect(resolveDate('today', tueMidday())).toBe('2026-04-21');
  });
  it('returns tomorrow', () => {
    expect(resolveDate('tomorrow', tueMidday())).toBe('2026-04-22');
  });
  it('returns next workday — Tue→Wed', () => {
    expect(resolveDate('next-workday', tueMidday())).toBe('2026-04-22');
  });
  it('returns next workday — Fri→Mon', () => {
    expect(resolveDate('next-workday', friMidday())).toBe('2026-04-27');
  });
  it('accepts explicit YYYY-MM-DD', () => {
    expect(resolveDate('2026-04-30', tueMidday())).toBe('2026-04-30');
  });
  it('rejects bad date string', () => {
    expect(() => resolveDate('yesterday', tueMidday())).toThrow(/invalid --date/);
  });
});

describe('extractUncheckedItems', () => {
  it('picks up only - [ ] items in ## Action Items', () => {
    const src = [
      '---',
      'kind: daily',
      '---',
      '# 2026-04-20',
      '',
      '## Action Items',
      '',
      '- [ ] unchecked A',
      '- [x] done B',
      '- plain bullet C',
      '- [ ] unchecked D',
      '',
      '## Notes',
      '',
      '- [ ] not in action items',
    ].join('\n');
    expect(extractUncheckedItems(src)).toEqual(['unchecked A', 'unchecked D']);
  });
});

describe('dailyNew + dailyAdd', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'mm-daily-'));
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('new: writes today by default', async () => {
    const res = await dailyNew({}, { vaultRoot: vault, now: tueMidday });
    expect(res.relPath).toBe('Daily/2026-04-21.md');
    expect(res.carried).toBe(0);
    const raw = await readFile(res.path, 'utf8');
    expect(raw).toContain('kind: daily');
    expect(raw).toContain('title: 2026-04-21');
    expect(raw).toContain('## Action Items');
  });

  it('new --date tomorrow: writes tomorrow', async () => {
    const res = await dailyNew({ date: 'tomorrow' }, { vaultRoot: vault, now: tueMidday });
    expect(res.relPath).toBe('Daily/2026-04-22.md');
  });

  it('new --date next-workday on Friday writes Monday', async () => {
    const res = await dailyNew({ date: 'next-workday' }, { vaultRoot: vault, now: friMidday });
    expect(res.relPath).toBe('Daily/2026-04-27.md');
  });

  it('new --from carries unchecked items only', async () => {
    await mkdir(join(vault, 'Daily'), { recursive: true });
    await writeFile(
      join(vault, 'Daily/2026-04-20.md'),
      [
        '---',
        'kind: daily',
        'title: 2026-04-20',
        '---',
        '# 2026-04-20',
        '',
        '## Action Items',
        '',
        '- [ ] leftover one',
        '- [x] finished',
        '- plain',
        '- [ ] leftover two',
        '',
      ].join('\n'),
      'utf8',
    );
    const res = await dailyNew(
      { date: '2026-04-21', from: '2026-04-20' },
      { vaultRoot: vault, now: tueMidday },
    );
    expect(res.carried).toBe(2);
    const raw = await readFile(res.path, 'utf8');
    expect(raw).toContain('- leftover one');
    expect(raw).toContain('- leftover two');
    expect(raw).not.toContain('finished');
    expect(raw).not.toContain('- plain');
  });

  it('new: errors on duplicate', async () => {
    const ctx = { vaultRoot: vault, now: tueMidday };
    await dailyNew({}, ctx);
    await expect(dailyNew({}, ctx)).rejects.toThrow(/already exists/);
  });

  it('new --from: errors if source missing', async () => {
    await expect(
      dailyNew({ from: '1999-01-01' }, { vaultRoot: vault, now: tueMidday }),
    ).rejects.toThrow(/source not found/);
  });

  it('add: creates file with item when missing', async () => {
    const res = await dailyAdd(
      'ship 0.2.8',
      { date: 'tomorrow' },
      { vaultRoot: vault, now: tueMidday },
    );
    expect(res.created).toBe(true);
    const raw = await readFile(res.path, 'utf8');
    expect(raw).toContain('## Action Items');
    expect(raw).toContain('- ship 0.2.8');
  });

  it('add: appends under existing ## Action Items', async () => {
    const ctx = { vaultRoot: vault, now: tueMidday };
    await dailyNew({}, ctx);
    await dailyAdd('first', {}, ctx);
    await dailyAdd('second', {}, ctx);
    const raw = await readFile(join(vault, 'Daily/2026-04-21.md'), 'utf8');
    const actionBlock = raw.split('## Action Items')[1] ?? '';
    expect(actionBlock).toContain('- first');
    expect(actionBlock).toContain('- second');
    expect(actionBlock.indexOf('- first')).toBeLessThan(actionBlock.indexOf('- second'));
  });

  it('add: creates ## Action Items section when missing', async () => {
    await mkdir(join(vault, 'Daily'), { recursive: true });
    const p = join(vault, 'Daily/2026-04-21.md');
    await writeFile(
      p,
      ['---', 'kind: daily', '---', '# 2026-04-21', '', '## Notes', '', '- stuff', ''].join('\n'),
      'utf8',
    );
    await dailyAdd('new task', {}, { vaultRoot: vault, now: tueMidday });
    const raw = await readFile(p, 'utf8');
    expect(raw).toContain('## Notes');
    expect(raw).toContain('## Action Items');
    expect(raw).toContain('- new task');
  });

  it('add: rejects empty item', async () => {
    await expect(dailyAdd('   ', {}, { vaultRoot: vault, now: tueMidday })).rejects.toThrow(
      /empty/,
    );
  });
});
