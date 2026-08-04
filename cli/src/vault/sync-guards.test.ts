import { describe, expect, it } from 'vitest';
import { analyzeStagedChanges, findUnstagedEntries, parseRawDiffZ } from './sync-guards.js';

function raw(...records: string[]): string {
  return records.join('');
}
const A = (sha: string, path: string) => `:000000 100644 0000000 ${sha} A\0${path}\0`;
const D = (sha: string, path: string) => `:100644 000000 ${sha} 0000000 D\0${path}\0`;
const M = (src: string, dst: string, path: string) => `:100644 100644 ${src} ${dst} M\0${path}\0`;
const R = (sha: string, from: string, to: string) =>
  `:100644 100644 ${sha} ${sha} R100\0${from}\0${to}\0`;

describe('parseRawDiffZ', () => {
  it('returns an empty list for empty input', () => {
    expect(parseRawDiffZ('')).toEqual([]);
  });

  it('parses add, delete, and modify records', () => {
    const changes = parseRawDiffZ(raw(A('aaa', 'a.md'), D('bbb', 'b.md'), M('c1', 'c2', 'c.md')));
    expect(changes).toEqual([
      { status: 'A', srcSha: '0000000', dstSha: 'aaa', path: 'a.md', origPath: null },
      { status: 'D', srcSha: 'bbb', dstSha: '0000000', path: 'b.md', origPath: null },
      { status: 'M', srcSha: 'c1', dstSha: 'c2', path: 'c.md', origPath: null },
    ]);
  });

  it('parses a rename record with both paths', () => {
    const changes = parseRawDiffZ(raw(R('ddd', 'Plans/x.md', 'Archive/Plans/x.md')));
    expect(changes).toEqual([
      {
        status: 'R',
        srcSha: 'ddd',
        dstSha: 'ddd',
        path: 'Archive/Plans/x.md',
        origPath: 'Plans/x.md',
      },
    ]);
  });

  it('parses paths containing spaces', () => {
    expect(parseRawDiffZ(raw(A('eee', 'Work/my note.md')))[0].path).toBe('Work/my note.md');
  });
});

describe('analyzeStagedChanges', () => {
  it('reports no violations for a plain edit', () => {
    const report = analyzeStagedChanges(parseRawDiffZ(raw(M('c1', 'c2', 'Work/note.md'))));
    expect(report.violations).toEqual([]);
    expect(report.safe).toBe(true);
  });

  it('accepts an archive move detected as a rename', () => {
    const report = analyzeStagedChanges(
      parseRawDiffZ(raw(R('ddd', 'Plans/x.md', 'Archive/Plans/x.md'))),
    );
    expect(report.violations).toEqual([]);
  });

  it('accepts a move split into a separate delete and add of identical content', () => {
    const report = analyzeStagedChanges(
      parseRawDiffZ(raw(D('ddd', 'Plans/x.md'), A('ddd', 'Archive/Plans/x.md'))),
    );
    expect(report.violations).toEqual([]);
    expect(report.movedNotes).toEqual(['Plans/x.md']);
  });

  it('flags a deletion whose content reappears nowhere, the 2026-08-02 shape', () => {
    const report = analyzeStagedChanges(
      parseRawDiffZ(raw(D('ddd', 'Plans/x.md'), A('eee', 'Work/unrelated.md'))),
    );
    expect(report.safe).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].guard).toBe('unexplained-deletion');
    expect(report.violations[0].paths).toEqual(['Plans/x.md']);
  });

  it('flags a commit that only deletes notes', () => {
    const report = analyzeStagedChanges(parseRawDiffZ(raw(D('d1', 'a.md'), D('d2', 'b.md'))));
    const guards = report.violations.map((v) => v.guard);
    expect(guards).toContain('delete-only');
    expect(guards).toContain('unexplained-deletion');
  });

  it('ignores non-note files when applying the deletion guards', () => {
    const report = analyzeStagedChanges(parseRawDiffZ(raw(D('ddd', '.obsidian/workspace.json'))));
    expect(report.violations).toEqual([]);
  });

  it('counts each change kind', () => {
    const report = analyzeStagedChanges(
      parseRawDiffZ(raw(A('a1', 'a.md'), M('m1', 'm2', 'b.md'), R('r1', 'c.md', 'Archive/c.md'))),
    );
    expect(report.counts).toEqual({ added: 1, modified: 1, deleted: 0, renamed: 1 });
  });
});

describe('findUnstagedEntries', () => {
  it('returns nothing when every change is staged', () => {
    expect(findUnstagedEntries('A  Work/a.md\nM  Work/b.md\n')).toEqual([]);
  });

  it('reports untracked and unstaged-modification entries', () => {
    expect(findUnstagedEntries('A  Work/a.md\n M Work/b.md\n?? Work/c.md\n')).toEqual([
      'Work/b.md',
      'Work/c.md',
    ]);
  });
});
