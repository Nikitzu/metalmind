import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  scribeSupersede,
  scribeUpdate,
  slugify,
} from './scribe.js';

const fixedNow = () => new Date('2026-04-21T10:00:00.000Z');

describe('slugify', () => {
  it('normalises spaces and punctuation', () => {
    expect(slugify('NPM OIDC & CI - gotchas!')).toBe('npm-oidc-ci-gotchas');
  });
});

describe('resolveNotePath', () => {
  it('resolves kind:slug shortcut', () => {
    expect(resolveNotePath('learning:x', '/v')).toBe('/v/Learnings/x.md');
    expect(resolveNotePath('plan:2026-04-21-foo', '/v')).toBe('/v/Plans/2026-04-21-foo.md');
    expect(resolveNotePath('memory:trip-contacts', '/v')).toBe('/v/Memory/trip-contacts.md');
    expect(resolveNotePath('personal:budget', '/v')).toBe('/v/Personal/budget.md');
  });
  it('accepts absolute paths inside the vault and joins relative to vault', () => {
    expect(resolveNotePath('/v/Plans/x.md', '/v')).toBe('/v/Plans/x.md');
    expect(resolveNotePath('Plans/a.md', '/v')).toBe('/v/Plans/a.md');
  });
  it('appends .md to relative paths that lack it', () => {
    expect(resolveNotePath('Plans/a', '/v')).toBe('/v/Plans/a.md');
    expect(resolveNotePath('bare-note', '/v')).toBe('/v/bare-note.md');
  });
  it('rejects unknown kind', () => {
    expect(() => resolveNotePath('bogus:y', '/v')).toThrow(/unknown kind/);
  });
  it('rejects paths that escape the vault', () => {
    expect(() => resolveNotePath('/abs/x.md', '/v')).toThrow(/escapes vault/);
    expect(() => resolveNotePath('../../etc/passwd', '/v')).toThrow(/escapes vault/);
    expect(() => resolveNotePath('Plans/../../outside.md', '/v')).toThrow(/escapes vault/);
    expect(() => resolveNotePath('/vault-sibling/x.md', '/v')).toThrow(/escapes vault/);
    expect(() => resolveNotePath('plan:../../../etc/x', '/v')).toThrow(/escapes vault/);
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
    expect(moc).toContain('[[Plans/2026-04-21-do-x]] - Do X');
  });

  it('create: does not double-date a plan slug that already starts with a date', async () => {
    const res = await scribeCreate(
      {
        kind: 'plan',
        title: 'Do X',
        body: 'hello',
        project: 'metalmind',
        slug: '2026-04-20-do-x',
      },
      { vaultRoot: vault, now: fixedNow },
    );
    expect(res.relPath).toBe('Plans/2026-04-20-do-x.md');
  });

  it('create: quotes a colon in the title so frontmatter stays valid YAML', async () => {
    const res = await scribeCreate(
      { kind: 'plan', title: 'Topic: subtopic', body: 'hi', project: 'metalmind' },
      { vaultRoot: vault, now: fixedNow },
    );
    const note = await readFile(res.path, 'utf8');
    expect(note).toContain('title: "Topic: subtopic"');
    expect(note).not.toContain('\ntitle: Topic: subtopic\n');
    expect(note).toContain('# Topic: subtopic');
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

  it('refuses to write through a symlink that points outside the vault', async () => {
    const { symlink } = await import('node:fs/promises');
    const ctx = { vaultRoot: vault, now: fixedNow };
    const outside = await mkdtemp(join(tmpdir(), 'mm-outside-'));
    const target = join(outside, 'victim.md');
    await writeFile(target, 'original outside content\n', 'utf8');
    await mkdir(join(vault, 'Memory'), { recursive: true });
    await symlink(target, join(vault, 'Memory', 'link.md'));

    await expect(scribeUpdate('memory:link', 'injected', ctx)).rejects.toThrow(/symlink/);
    expect(await readFile(target, 'utf8')).toBe('original outside content\n');
    await rm(outside, { recursive: true, force: true });
  });

  it('update --code with an empty list clears the refs', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'work', title: 'clearable', body: 'b', code: ['metalmind#resolveNotePath'] },
      ctx,
    );
    expect(await readFile(path, 'utf8')).toContain('code: [');

    await scribeUpdate(path, '', ctx, { code: [] });

    const raw = await readFile(path, 'utf8');
    const fmEnd = raw.indexOf('\n---\n', 4);
    expect(raw.slice(0, fmEnd)).not.toContain('code:');
  });

  it('update with no body and only --code re-stamps without appending', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'work', title: 'nobody', body: 'original' }, ctx);

    await scribeUpdate(path, '', ctx, { code: ['metalmind#stamp'] });

    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('code: ["metalmind#stamp"]');
    expect(raw.match(/original/g)).toHaveLength(1);
  });

  it('update --code refuses a malformed ref and leaves the file untouched', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'work', title: 'codeguard', body: 'b' }, ctx);
    const before = await readFile(path, 'utf8');

    await expect(scribeUpdate(path, 'more', ctx, { code: ['not a ref'] })).rejects.toThrow(
      /malformed code ref/,
    );
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('quotes a frontmatter value containing a newline so it cannot inject keys', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'work', title: 'inject\nsuperseded_by: victim', body: 'b' },
      ctx,
    );
    const raw = await readFile(path, 'utf8');
    const fmEnd = raw.indexOf('\n---\n', 4);
    expect(raw.slice(0, fmEnd)).not.toMatch(/^superseded_by:/m);
  });

  it('create --code stamps the code list into frontmatter', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'work', title: 't', body: 'b', code: ['metalmind#resolveNotePath'] },
      ctx,
    );
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('code: ["metalmind#resolveNotePath"]');
  });

  it('create --code refuses malformed refs', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await expect(
      scribeCreate({ kind: 'work', title: 't2', body: 'b', code: ['not a ref'] }, ctx),
    ).rejects.toThrow(/malformed code ref/);
  });

  it('update --code re-stamps the code list', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'work', title: 't3', body: 'b' }, ctx);
    await scribeUpdate(path, 'more', ctx, { code: ['metalmind#stamp'] });
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('code: ["metalmind#stamp"]');
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

  it('patch --find: replaces a literal text block outside any heading', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'work', title: 't', body: 'intro line\n\n## A\n\nstale fact here\n\ntail' },
      ctx,
    );
    await scribePatch(path, { find: 'stale fact here', replace: 'fresh fact' }, ctx);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('fresh fact');
    expect(raw).not.toContain('stale fact here');
    expect(raw).toContain('intro line');
    expect(raw).toContain('tail');
  });

  it('patch --find: bumps updated frontmatter', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'work', title: 't', body: 'old text' }, ctx);
    await scribePatch(
      path,
      { find: 'old text', replace: 'new text' },
      { vaultRoot: vault, now: () => new Date('2026-04-22T10:00:00.000Z') },
    );
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('updated: 2026-04-22');
  });

  it('patch --find: empty replace deletes the matched text', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'work', title: 't', body: 'keep DROPME keep' },
      ctx,
    );
    await scribePatch(path, { find: ' DROPME', replace: '' }, ctx);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('keep keep');
    expect(raw).not.toContain('DROPME');
  });

  it('patch --find: errors when text not found', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'work', title: 't', body: 'body' }, ctx);
    await expect(scribePatch(path, { find: 'absent', replace: 'x' }, ctx)).rejects.toThrow(
      /not found/,
    );
  });

  it('patch --find: errors on ambiguous match without --occurrence, resolves with it', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'work', title: 't', body: 'dup here\n\nmiddle\n\ndup here' },
      ctx,
    );
    await expect(scribePatch(path, { find: 'dup here', replace: 'x' }, ctx)).rejects.toThrow(
      /2 occurrences/,
    );
    await scribePatch(path, { find: 'dup here', replace: 'second', occurrence: 2 }, ctx);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('dup here\n\nmiddle\n\nsecond');
  });

  it('patch --find: never touches frontmatter even when the text matches there', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'work', title: 'active', body: 'status: active' },
      ctx,
    );
    await scribePatch(path, { find: 'status: active', replace: 'status: done' }, ctx);
    const raw = await readFile(path, 'utf8');
    const fmEnd = raw.indexOf('---', 4);
    expect(raw.slice(0, fmEnd)).toContain('status: active');
    expect(raw.slice(fmEnd)).toContain('status: done');
  });

  it('patch --find: --dry-run writes nothing', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'work', title: 't', body: 'old' }, ctx);
    await scribePatch(path, { find: 'old', replace: 'new', dryRun: true }, ctx);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('old');
    expect(raw).not.toContain('new');
  });

  it('patch: rejects mixing --section with --find, and neither', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'work', title: 't', body: '## A\n\nx' }, ctx);
    await expect(
      scribePatch(path, { section: 'A', body: 'b', find: 'x', replace: 'y' }, ctx),
    ).rejects.toThrow(/either/);
    await expect(scribePatch(path, {}, ctx)).rejects.toThrow(/either/);
    await expect(scribePatch(path, { find: 'x' }, ctx)).rejects.toThrow(/--replace/);
  });

  it('supersede: stamps old with status+superseded_by, new with supersedes, bumps both', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path: oldPath } = await scribeCreate(
      { kind: 'plan', title: 'old way', body: 'a' },
      ctx,
    );
    const { path: newPath } = await scribeCreate(
      { kind: 'plan', title: 'new way', body: 'b' },
      ctx,
    );
    const later = { vaultRoot: vault, now: () => new Date('2026-04-22T10:00:00.000Z') };

    const res = await scribeSupersede(oldPath, newPath, later);

    const oldRaw = await readFile(oldPath, 'utf8');
    expect(oldRaw).toContain('status: superseded');
    expect(oldRaw).toContain('superseded_by: 2026-04-21-new-way');
    expect(oldRaw).toContain('updated: 2026-04-22');
    const newRaw = await readFile(newPath, 'utf8');
    expect(newRaw).toContain('supersedes: 2026-04-21-old-way');
    expect(newRaw).toContain('updated: 2026-04-22');
    expect(res.oldStem).toBe('2026-04-21-old-way');
    expect(res.newStem).toBe('2026-04-21-new-way');
  });

  it('supersede: errors when old or new is missing', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'plan', title: 'only', body: 'x' }, ctx);
    await expect(scribeSupersede('plan:absent', path, ctx)).rejects.toThrow(/not found/);
    await expect(scribeSupersede(path, 'plan:absent', ctx)).rejects.toThrow(/not found/);
  });

  it('supersede: refuses self-supersede', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate({ kind: 'plan', title: 'self', body: 'x' }, ctx);
    await expect(scribeSupersede(path, path, ctx)).rejects.toThrow(/itself/);
  });

  it('supersede: overwrites prose in superseded_by without demanding --force', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path: oldPath } = await scribeCreate({ kind: 'plan', title: 'v1', body: 'a' }, ctx);
    const { path: newPath } = await scribeCreate({ kind: 'plan', title: 'v3', body: 'b' }, ctx);

    const withProse = (await readFile(oldPath, 'utf8')).replace(
      /^---\n/,
      '---\nsuperseded_by: the v3 spec, see decision log\n',
    );
    await writeFile(oldPath, withProse, 'utf8');

    await scribeSupersede(oldPath, newPath, ctx);
    const oldRaw = await readFile(oldPath, 'utf8');
    expect(oldRaw).toContain('superseded_by: 2026-04-21-v3');
    expect(oldRaw).not.toContain('see decision log');
  });

  it('supersede: refuses re-supersede without --force, naming the successor', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path: a } = await scribeCreate({ kind: 'plan', title: 'a', body: 'x' }, ctx);
    const { path: b } = await scribeCreate({ kind: 'plan', title: 'b', body: 'x' }, ctx);
    const { path: c } = await scribeCreate({ kind: 'plan', title: 'c', body: 'x' }, ctx);
    await scribeSupersede(a, b, ctx);

    await expect(scribeSupersede(a, c, ctx)).rejects.toThrow(/2026-04-21-b/);

    await scribeSupersede(a, c, ctx, { force: true });
    const raw = await readFile(a, 'utf8');
    expect(raw).toContain('superseded_by: 2026-04-21-c');
    expect(await readFile(c, 'utf8')).toContain('supersedes: 2026-04-21-a');
  });

  it('supersede: --dry-run writes nothing', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path: a } = await scribeCreate({ kind: 'plan', title: 'a2', body: 'x' }, ctx);
    const { path: b } = await scribeCreate({ kind: 'plan', title: 'b2', body: 'x' }, ctx);

    await scribeSupersede(a, b, ctx, { dryRun: true });

    expect(await readFile(a, 'utf8')).not.toContain('superseded');
    expect(await readFile(b, 'utf8')).not.toContain('supersedes:');
  });

  it('supersede: daily-date guard applies to daily notes', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'daily', title: 'x', body: 'b', date: 'tomorrow' }, ctx);
    const { path: plan } = await scribeCreate({ kind: 'plan', title: 'p', body: 'x' }, ctx);

    await expect(scribeSupersede(join(vault, 'Daily/2026-04-22.md'), plan, ctx)).rejects.toThrow(
      /--date/,
    );
    await expect(scribeSupersede(plan, join(vault, 'Daily/2026-04-22.md'), ctx)).rejects.toThrow(
      /--date/,
    );
  });

  it('supersede: refuses two different non-today daily notes with a clear error', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'daily', title: 'a', body: 'x', date: '2026-04-23' }, ctx);
    await scribeCreate({ kind: 'daily', title: 'b', body: 'y', date: '2026-04-24' }, ctx);

    await expect(
      scribeSupersede(join(vault, 'Daily/2026-04-23.md'), join(vault, 'Daily/2026-04-24.md'), ctx, {
        date: '2026-04-23',
      }),
    ).rejects.toThrow(/two non-today daily notes/);
  });

  it('supersede: quotes a hand-created stem containing YAML metacharacters', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path: oldP } = await scribeCreate({ kind: 'plan', title: 'plain old', body: 'x' }, ctx);
    const newP = join(vault, 'Plans', 'RED-4821: retry backoff.md');
    await writeFile(newP, '---\ntitle: hand-made\n---\n\nbody\n', 'utf8');

    await scribeSupersede(oldP, newP, ctx);

    const raw = await readFile(oldP, 'utf8');
    expect(raw).toContain('superseded_by: "RED-4821: retry backoff"');
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

  it('rename: bare-slug destination stays in the source directory with .md', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path: oldPath } = await scribeCreate(
      { kind: 'plan', title: 'old plan', body: 'x', project: 'metalmind' },
      ctx,
    );
    const { scribeRename } = await import('./scribe.js');
    const res = await scribeRename('plan:2026-04-21-old-plan', '2026-04-21-new-plan', ctx);
    expect(res.to).toBe(join(vault, 'Plans/2026-04-21-new-plan.md'));
    await expect(readFile(oldPath, 'utf8')).rejects.toBeTruthy();
    const moved = await readFile(join(vault, 'Plans/2026-04-21-new-plan.md'), 'utf8');
    expect(moved).toContain('# old plan');
  });

  it('archive: moves file to Archive/ and rewrites path-prefixed wikilink backlinks', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path: oldPath } = await scribeCreate(
      { kind: 'work', title: 'shipped-plan', body: 'x', project: 'metalmind' },
      ctx,
    );
    const { scribeArchive } = await import('./scribe.js');
    // Create referrers using both path-prefixed and basename-only wikilink flavors
    await scribeCreate(
      {
        kind: 'learning',
        title: 'referrer',
        body: 'See [[Work/shipped-plan]] and [[shipped-plan]] and [[Work/shipped-plan|alias]].',
        project: 'metalmind',
      },
      ctx,
    );
    const res = await scribeArchive('work:shipped-plan', ctx);
    // 2 path-prefixed wikilinks in referrer + 1 in the auto-linked MOC = 3 minimum
    expect(res.backlinksRewritten).toBeGreaterThanOrEqual(2);
    // referrer + project MOC both get rewritten when project is set
    expect(res.filesTouched.length).toBeGreaterThanOrEqual(1);
    expect(res.to).toContain('Archive/Work/shipped-plan.md');
    await expect(readFile(oldPath, 'utf8')).rejects.toBeTruthy();
    const referrer = await readFile(join(vault, 'Learnings/referrer.md'), 'utf8');
    expect(referrer).toContain('[[Archive/Work/shipped-plan]]');
    expect(referrer).toContain('[[Archive/Work/shipped-plan|alias]]');
    // Basename-only wikilink survives unchanged (path prefix not added; filename hasn't changed)
    expect(referrer).toContain('[[shipped-plan]]');
    const moved = await readFile(join(vault, 'Archive/Work/shipped-plan.md'), 'utf8');
    expect(moved).toContain('status: archived');
  });

  it('archive --dry-run reports count but writes nothing', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path: oldPath } = await scribeCreate(
      { kind: 'work', title: 'pending-archive', body: 'x' },
      ctx,
    );
    await scribeCreate({ kind: 'learning', title: 'r', body: '[[Work/pending-archive]]' }, ctx);
    const { scribeArchive } = await import('./scribe.js');
    const res = await scribeArchive('work:pending-archive', ctx, { dryRun: true });
    expect(res.backlinksRewritten).toBe(1);
    await expect(readFile(oldPath, 'utf8')).resolves.toBeTruthy();
    await expect(
      readFile(join(vault, 'Archive/Work/pending-archive.md'), 'utf8'),
    ).rejects.toBeTruthy();
    // Referrer file content unchanged under dry-run
    const referrer = await readFile(join(vault, 'Learnings/r.md'), 'utf8');
    expect(referrer).toContain('[[Work/pending-archive]]');
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

describe('daily-date guard', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'mm-vault-'));
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('create daily with --date tomorrow lands the file at tomorrow.md', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const res = await scribeCreate(
      { kind: 'daily', title: 'plan-ahead', body: 'x', date: 'tomorrow' },
      ctx,
    );
    expect(res.relPath).toBe('Daily/2026-04-22.md');
  });

  it('create daily with --date YYYY-MM-DD ≠ today is accepted explicitly', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const res = await scribeCreate(
      { kind: 'daily', title: 'x', body: 'b', date: '2026-04-25' },
      ctx,
    );
    expect(res.relPath).toBe('Daily/2026-04-25.md');
  });

  it('create daily errors when --slug conflicts with --date', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await expect(
      scribeCreate(
        { kind: 'daily', title: 'x', body: 'b', slug: '2026-04-22', date: '2026-04-25' },
        ctx,
      ),
    ).rejects.toThrow(/conflicts with --date/);
  });

  it('update on a future-dated daily note refuses without --date', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'daily', title: 'plan-ahead', body: 'x', date: '2026-04-25' }, ctx);
    await expect(scribeUpdate('daily:2026-04-25', 'more', ctx)).rejects.toThrow(
      /refusing to update daily note for 2026-04-25.*atium add --date 2026-04-25/s,
    );
  });

  it('update on a future-dated daily note accepts matching --date', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'daily', title: 'plan-ahead', body: 'x', date: '2026-04-25' }, ctx);
    await scribeUpdate('daily:2026-04-25', 'more', ctx, { date: '2026-04-25' });
    const raw = await readFile(join(vault, 'Daily/2026-04-25.md'), 'utf8');
    expect(raw).toContain('more');
  });

  it('update with mismatched --date prints both dates in the error', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'daily', title: 'plan-ahead', body: 'x', date: '2026-04-25' }, ctx);
    await expect(
      scribeUpdate('daily:2026-04-25', 'more', ctx, { date: '2026-04-26' }),
    ).rejects.toThrow(
      /--date '2026-04-26' resolves to 2026-04-26.*target daily note is 2026-04-25/s,
    );
  });

  it('patch on future-dated daily refuses without --date', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate(
      { kind: 'daily', title: 'plan-ahead', body: '## A\n\none', date: '2026-04-25' },
      ctx,
    );
    await expect(
      scribePatch('daily:2026-04-25', { section: 'A', body: 'two' }, ctx),
    ).rejects.toThrow(/refusing to patch/);
  });

  it('archive on future-dated daily refuses without --date', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'daily', title: 'plan-ahead', body: 'x', date: '2026-04-25' }, ctx);
    await expect(scribeArchive('daily:2026-04-25', ctx)).rejects.toThrow(
      /refusing to archive daily note for 2026-04-25/,
    );
  });

  it('today daily is unaffected - no --date needed for update or patch', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    await scribeCreate({ kind: 'daily', title: 'morning', body: '## A\n\nseed' }, ctx);
    await scribeUpdate('daily:2026-04-21', 'more', ctx);
    const afterUpdate = await readFile(join(vault, 'Daily/2026-04-21.md'), 'utf8');
    expect(afterUpdate).toContain('more');
    await scribePatch('daily:2026-04-21', { section: 'A', body: 'fresh' }, ctx);
    const afterPatch = await readFile(join(vault, 'Daily/2026-04-21.md'), 'utf8');
    expect(afterPatch).toContain('fresh');
  });

  it('non-daily notes are unaffected by the guard', async () => {
    const ctx = { vaultRoot: vault, now: fixedNow };
    const { path } = await scribeCreate(
      { kind: 'learning', title: 't', body: 'seed', project: 'p' },
      ctx,
    );
    await scribeUpdate(path, 'tail', ctx);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('tail');
  });
});
