import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveNotePath,
  scribeArchive,
  scribeCreate,
  scribeDelete,
  scribeList,
  scribePatch,
  scribeShow,
  scribeUpdate,
  slugify,
} from './scribe.js';

const fixedNow = () => new Date('2026-04-21T10:00:00.000Z');

describe('slugify', () => {
  it('normalises spaces and punctuation', () => {
    expect(slugify('NPM OIDC & CI — gotchas!')).toBe('npm-oidc-ci-gotchas');
  });
});

describe('resolveNotePath', () => {
  it('resolves kind:slug shortcut', () => {
    expect(resolveNotePath('learning:x', '/v')).toBe('/v/Learnings/x.md');
    expect(resolveNotePath('plan:2026-04-21-foo', '/v')).toBe('/v/Plans/2026-04-21-foo.md');
    expect(resolveNotePath('memory:trip-contacts', '/v')).toBe('/v/Memory/trip-contacts.md');
    expect(resolveNotePath('personal:budget', '/v')).toBe('/v/Personal/budget.md');
  });
  it('passes absolute through and joins relative to vault', () => {
    expect(resolveNotePath('/abs/x.md', '/v')).toBe('/abs/x.md');
    expect(resolveNotePath('Plans/a.md', '/v')).toBe('/v/Plans/a.md');
  });
  it('rejects unknown kind', () => {
    expect(() => resolveNotePath('bogus:y', '/v')).toThrow(/unknown kind/);
  });
});

describe('scribe CRUD', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'mm-vault-'));
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('create: writes frontmatter + body + MOC link', async () => {
    const res = await scribeCreate(
      { kind: 'plan', title: 'Do X', body: 'hello', project: 'metalmind' },
      { vaultRoot: vault, now: fixedNow },
    );
    expect(res.relPath).toBe('Plans/2026-04-21-do-x.md');
    const note = await readFile(res.path, 'utf8');
    expect(note).toContain('project: metalmind');
    expect(note).toContain('created: 2026-04-21');
    expect(note).toContain('# Do X');
    expect(note).toContain('hello');
    const moc = await readFile(join(vault, 'Work/MOCs/metalmind.md'), 'utf8');
    expect(moc).toContain('[[Plans/2026-04-21-do-x]] — Do X');
  });

  it('create daily: appends if file exists', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'daily', title: 'morning', body: 'a' }, ctx);
    await scribeCreate({ kind: 'daily', title: 'afternoon', body: 'b' }, ctx);
    const f = await readFile(join(vault, 'Daily/2026-04-21.md'), 'utf8');
    expect(f).toContain('# morning');
    expect(f).toContain('## afternoon');
  });

  it('create daily with --slug ≠ today errors pointing at atium/daily new', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await expect(
      scribeCreate({ kind: 'daily', title: '2026-04-22', body: 'x', slug: '2026-04-22' }, ctx),
    ).rejects.toThrow(/metalmind atium new --date 2026-04-22/);
  });

  it('create daily with --slug equal to today is accepted', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'daily', title: 'x', body: 'b', slug: '2026-04-21' }, ctx);
  });

  it('create refuses duplicate for non-daily kind', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'learning', title: 't', body: 'x' }, ctx);
    await expect(scribeCreate({ kind: 'learning', title: 't', body: 'y' }, ctx)).rejects.toThrow(
      /already exists/,
    );
  });

  it('update: appends body and bumps updated', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'learning', title: 't', body: 'orig', project: 'x' },
      ctx,
    );
    await scribeUpdate(path, 'new lines', {
      vaultRoot: vault,
      now: () => new Date('2026-04-22T10:00:00.000Z'),
    });
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('updated: 2026-04-22');
    expect(raw).toContain('orig');
    expect(raw).toContain('new lines');
  });

  it('patch: replaces unique section body', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'work', title: 't', body: '## A\n\nold\n\n## B\n\nkeep', project: 'x' },
      ctx,
    );
    await scribePatch(path, { section: 'A', body: 'new content' }, ctx);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('## A');
    expect(raw).toContain('new content');
    expect(raw).not.toContain('old');
    expect(raw).toContain('## B');
    expect(raw).toContain('keep');
  });

  it('patch: errors on ambiguous section when --occurrence not passed', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'work', title: 't', body: '## A\n\none\n\n## A\n\ntwo' },
      ctx,
    );
    await expect(scribePatch(path, { section: 'A', body: 'n' }, ctx)).rejects.toThrow(
      /2 occurrences/,
    );
  });

  it('patch: matches section headings containing regex metacharacters (parens, dots)', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      {
        kind: 'work',
        title: 't',
        body: '## Known issues (next-session pickups)\n\nold\n\n## Other (v2.0)\n\nkeep',
        project: 'x',
      },
      ctx,
    );
    await scribePatch(path, { section: 'Known issues (next-session pickups)', body: 'fresh' }, ctx);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('## Known issues (next-session pickups)');
    expect(raw).toContain('fresh');
    expect(raw).not.toContain('old');
    expect(raw).toContain('## Other (v2.0)');
    expect(raw).toContain('keep');
  });

  it('patch: --occurrence 2 targets the second match', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'work', title: 't', body: '## A\n\none\n\n## A\n\ntwo' },
      ctx,
    );
    await scribePatch(path, { section: 'A', body: 'TWO', occurrence: 2 }, ctx);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('one');
    expect(raw).toContain('TWO');
    expect(raw).not.toContain('two');
  });

  it('delete soft: moves to .trash and strips MOC link', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path, relPath } = await scribeCreate(
      { kind: 'learning', title: 't', body: 'x', project: 'metalmind' },
      ctx,
    );
    const res = await scribeDelete(path, ctx);
    expect(res.to).toBeDefined();
    expect(res.to).toContain('/.trash/');
    await expect(readFile(path, 'utf8')).rejects.toBeTruthy();
    const moc = await readFile(join(vault, 'Work/MOCs/metalmind.md'), 'utf8');
    expect(moc).not.toContain(relPath.replace(/\.md$/, ''));
  });

  it('delete --hard actually removes', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'learning', title: 't', body: 'x' }, ctx);
    await scribeDelete(path, ctx, { hard: true });
    await expect(readFile(path, 'utf8')).rejects.toBeTruthy();
  });

  it('archive: moves to Archive/ with status archived', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'learning', title: 't', body: 'x', project: 'metalmind' },
      ctx,
    );
    const res = await scribeArchive(path, ctx);
    expect(res.to).toContain('/Archive/Learnings/');
    const archived = await readFile(res.to, 'utf8');
    expect(archived).toContain('status: archived');
    await expect(readFile(path, 'utf8')).rejects.toBeTruthy();
    const moc = await readFile(join(vault, 'Work/MOCs/metalmind.md'), 'utf8');
    expect(moc).toContain('t');
  });

  it('list: filters by project', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'learning', title: 'a', body: 'x', project: 'p1' }, ctx);
    await scribeCreate({ kind: 'learning', title: 'b', body: 'y', project: 'p2' }, ctx);
    const entries = await scribeList(ctx, { project: 'p1', kind: 'learning' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('a');
  });

  it('show: returns full content', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'learning', title: 't', body: 'zzz' }, ctx);
    await expect(scribeShow(path, ctx)).resolves.toContain('zzz');
  });

  it('kind:slug resolves for update', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'learning', title: 't', body: 'x' }, ctx);
    await scribeUpdate('learning:t', 'appended', ctx);
    const raw = await readFile(join(vault, 'Learnings/t.md'), 'utf8');
    expect(raw).toContain('appended');
  });

  it('rename: moves file and rewrites wikilink backlinks', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path: oldPath } = await scribeCreate(
      { kind: 'learning', title: 'old-slug', body: 'x', project: 'metalmind' },
      ctx,
    );
    const { scribeRename } = await import('./scribe.js');
    // Create a sibling note that references the old slug in all wikilink flavors
    await scribeCreate(
      {
        kind: 'work',
        title: 'referrer',
        body: 'See [[Learnings/old-slug]] and [[old-slug#Context]] and [[old-slug|pretty name]].',
        project: 'metalmind',
      },
      ctx,
    );
    const res = await scribeRename('learning:old-slug', 'learning:new-slug', ctx);
    expect(res.backlinksRewritten).toBeGreaterThanOrEqual(3);
    await expect(readFile(oldPath, 'utf8')).rejects.toBeTruthy();
    const referrer = await readFile(join(vault, 'Work/referrer.md'), 'utf8');
    expect(referrer).toContain('[[Learnings/new-slug]]');
    expect(referrer).toContain('[[new-slug#Context]]');
    expect(referrer).toContain('[[new-slug|pretty name]]');
    const moved = await readFile(join(vault, 'Learnings/new-slug.md'), 'utf8');
    expect(moved).toContain('# old-slug');
  });

  it('rename --dry-run leaves files untouched but reports count', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path: oldPath } = await scribeCreate(
      { kind: 'learning', title: 'to-rename', body: 'x' },
      ctx,
    );
    await scribeCreate({ kind: 'work', title: 'r', body: '[[to-rename]]' }, ctx);
    const { scribeRename } = await import('./scribe.js');
    const res = await scribeRename('learning:to-rename', 'learning:renamed', ctx, {
      dryRun: true,
    });
    expect(res.backlinksRewritten).toBe(1);
    await expect(readFile(oldPath, 'utf8')).resolves.toBeTruthy();
    await expect(readFile(join(vault, 'Learnings/renamed.md'), 'utf8')).rejects.toBeTruthy();
  });

  it('dry-run on create does not write', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'learning', title: 'nothing', body: 'x', dryRun: true }, ctx);
    await expect(readFile(join(vault, 'Learnings/nothing.md'), 'utf8')).rejects.toBeTruthy();
  });
});
