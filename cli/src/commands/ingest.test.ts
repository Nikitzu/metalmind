import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestAutoMemory, tildeHome } from './ingest.js';

const fixedNow = () => new Date('2026-08-05T10:00:00.000Z');

describe('tildeHome', () => {
  it('collapses the home prefix so a synced vault carries no username', async () => {
    const { homedir } = await import('node:os');
    expect(tildeHome(join(homedir(), '.claude', 'projects', 'p', 'memory', 't.md'))).toBe(
      '~/.claude/projects/p/memory/t.md',
    );
  });

  it('leaves a path outside home untouched', () => {
    expect(tildeHome('/opt/elsewhere/t.md')).toBe('/opt/elsewhere/t.md');
  });
});

describe('ingestAutoMemory', () => {
  let projects: string;
  let vault: string;

  const memDir = (project: string) => join(projects, project, 'memory');

  beforeEach(async () => {
    projects = await mkdtemp(join(tmpdir(), 'mm-ingest-projects-'));
    vault = await mkdtemp(join(tmpdir(), 'mm-ingest-vault-'));
    await mkdir(memDir('-home-user-myproj'), { recursive: true });
    await writeFile(join(memDir('-home-user-myproj'), 'MEMORY.md'), '- [topic](topic.md)\n');
    await writeFile(join(memDir('-home-user-myproj'), 'topic.md'), 'never route around auth\n');
    await writeFile(join(memDir('-home-user-myproj'), 'empty.md'), '  \n');
  });
  afterEach(async () => {
    await rm(projects, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  });

  const run = (dryRun = false) =>
    ingestAutoMemory({ projectsDir: projects, vaultRoot: vault, dryRun, now: fixedNow });

  it('fresh import creates a Memory note with provenance, skipping MEMORY.md and empty files', async () => {
    const res = await run();

    expect(res.created).toEqual(['Memory/auto-home-user-myproj-topic.md']);
    expect(res.skipped).toEqual([]);
    const raw = await readFile(join(vault, 'Memory', 'auto-home-user-myproj-topic.md'), 'utf8');
    expect(raw).toContain('kind: memory');
    expect(raw).toContain('tags: ["auto-memory"]');
    expect(raw).toContain('source_path:');
    expect(raw).toMatch(/imported_hash: [0-9a-f]{40}/);
    expect(raw.endsWith('never route around auth\n')).toBe(true);
  });

  it('second run skips everything unchanged', async () => {
    await run();
    const res = await run();

    expect(res.created).toEqual([]);
    expect(res.updated).toEqual([]);
    expect(res.skipped).toEqual(['Memory/auto-home-user-myproj-topic.md']);
  });

  it('source change with unedited note overwrites body and re-hashes', async () => {
    await run();
    await writeFile(join(memDir('-home-user-myproj'), 'topic.md'), 'updated wisdom\n');

    const res = await run();

    expect(res.updated).toEqual(['Memory/auto-home-user-myproj-topic.md']);
    const raw = await readFile(join(vault, 'Memory', 'auto-home-user-myproj-topic.md'), 'utf8');
    expect(raw).toContain('updated wisdom');
    expect(raw).not.toContain('never route around auth');
  });

  it('update re-stamps imported_hash so a third run is a no-op, and preserves other keys', async () => {
    await run();
    const notePath = join(vault, 'Memory', 'auto-home-user-myproj-topic.md');
    const withExtra = (await readFile(notePath, 'utf8')).replace(
      '\nstatus: active',
      '\nstatus: active\nproject: myproj\nsuperseded_by: some-newer-note',
    );
    await writeFile(notePath, withExtra, 'utf8');
    await writeFile(join(memDir('-home-user-myproj'), 'topic.md'), 'updated wisdom\n');

    const second = await run();
    expect(second.updated).toEqual(['Memory/auto-home-user-myproj-topic.md']);

    const raw = await readFile(notePath, 'utf8');
    expect(raw).toContain('project: myproj');
    expect(raw).toContain('superseded_by: some-newer-note');
    expect(raw).toContain('created: 2026-08-05');

    const third = await run();
    expect(third.updated).toEqual([]);
    expect(third.skipped).toEqual(['Memory/auto-home-user-myproj-topic.md']);
  });

  it('--dry-run on the update path writes nothing', async () => {
    await run();
    const notePath = join(vault, 'Memory', 'auto-home-user-myproj-topic.md');
    const before = await readFile(notePath, 'utf8');
    await writeFile(join(memDir('-home-user-myproj'), 'topic.md'), 'updated wisdom\n');

    const res = await run(true);

    expect(res.updated).toEqual(['Memory/auto-home-user-myproj-topic.md']);
    expect(await readFile(notePath, 'utf8')).toBe(before);
  });

  it('ignores nested memory subdirectories', async () => {
    await mkdir(join(memDir('-home-user-myproj'), 'sub'), { recursive: true });
    await writeFile(join(memDir('-home-user-myproj'), 'sub', 'deep.md'), 'nested\n');

    const res = await run();

    expect(res.created).toEqual(['Memory/auto-home-user-myproj-topic.md']);
  });

  it('source change with locally edited note conflicts and leaves the note alone', async () => {
    await run();
    const notePath = join(vault, 'Memory', 'auto-home-user-myproj-topic.md');
    const edited = (await readFile(notePath, 'utf8')).replace(
      'never route around auth',
      'my local edit',
    );
    await writeFile(notePath, edited, 'utf8');
    await writeFile(join(memDir('-home-user-myproj'), 'topic.md'), 'updated wisdom\n');

    const res = await run();

    expect(res.conflicts).toEqual(['Memory/auto-home-user-myproj-topic.md']);
    expect(await readFile(notePath, 'utf8')).toContain('my local edit');
  });

  it('--dry-run reports actions without writing', async () => {
    const res = await run(true);

    expect(res.created).toEqual(['Memory/auto-home-user-myproj-topic.md']);
    await expect(
      readFile(join(vault, 'Memory', 'auto-home-user-myproj-topic.md'), 'utf8'),
    ).rejects.toThrow();
  });

  it('missing projects dir reports cleanly', async () => {
    const res = await ingestAutoMemory({
      projectsDir: join(projects, 'nope'),
      vaultRoot: vault,
      now: fixedNow,
    });
    expect(res.created).toEqual([]);
    expect(res.skipped).toEqual([]);
  });
});
