import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRecentNotes } from './vault-browse.js';

async function writeNote(path: string, body: string, mtime: Date): Promise<void> {
  await writeFile(path, body, 'utf8');
  await utimes(path, mtime, mtime);
}

describe('listRecentNotes', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-browse-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns notes sorted by mtime desc, newest first', async () => {
    await mkdir(join(tmp, 'Inbox'), { recursive: true });
    await writeNote(join(tmp, 'Inbox', 'old.md'), '# Old\n\nbody', new Date(2020, 0, 1));
    await writeNote(join(tmp, 'Inbox', 'new.md'), '# New\n\nbody', new Date(2026, 0, 1));
    await writeNote(join(tmp, 'Inbox', 'mid.md'), '# Mid\n\nbody', new Date(2023, 0, 1));

    const notes = await listRecentNotes(tmp, 5);
    expect(notes.map((n) => n.title)).toEqual(['New', 'Mid', 'Old']);
  });

  it('respects the N cap', async () => {
    await mkdir(join(tmp, 'Inbox'), { recursive: true });
    for (let i = 0; i < 5; i += 1) {
      await writeNote(
        join(tmp, 'Inbox', `n${i}.md`),
        `# N${i}\n\nbody`,
        new Date(2020 + i, 0, 1),
      );
    }
    const notes = await listRecentNotes(tmp, 2);
    expect(notes).toHaveLength(2);
    expect(notes[0]?.title).toBe('N4');
  });

  it('extracts title from first heading, falling back to filename', async () => {
    await mkdir(join(tmp, 'Inbox'), { recursive: true });
    await writeNote(join(tmp, 'Inbox', 'with-heading.md'), '# My Heading\n\nhi', new Date(2026, 0, 2));
    await writeNote(join(tmp, 'Inbox', 'no-heading.md'), 'just a body', new Date(2026, 0, 1));

    const notes = await listRecentNotes(tmp, 5);
    expect(notes.find((n) => n.relPath.endsWith('with-heading.md'))?.title).toBe('My Heading');
    expect(notes.find((n) => n.relPath.endsWith('no-heading.md'))?.title).toBe('no-heading');
  });

  it('strips frontmatter before extracting excerpt', async () => {
    await mkdir(join(tmp, 'Inbox'), { recursive: true });
    const body = `---\ntitle: x\ntags: [a]\n---\n\n# Title\n\nreal excerpt text\n`;
    await writeNote(join(tmp, 'Inbox', 'fm.md'), body, new Date(2026, 0, 3));
    const notes = await listRecentNotes(tmp, 1);
    expect(notes[0]?.excerpt).toContain('real excerpt text');
    expect(notes[0]?.excerpt).not.toContain('title: x');
  });

  it('skips .obsidian, .metalmind-stack, .trash, and node_modules', async () => {
    for (const d of ['.obsidian', '.metalmind-stack', '.trash', 'node_modules']) {
      await mkdir(join(tmp, d), { recursive: true });
      await writeNote(join(tmp, d, 'junk.md'), '# Junk\n', new Date(2026, 0, 1));
    }
    await mkdir(join(tmp, 'Inbox'), { recursive: true });
    await writeNote(join(tmp, 'Inbox', 'keep.md'), '# Keep\n', new Date(2026, 0, 2));

    const notes = await listRecentNotes(tmp, 10);
    expect(notes.map((n) => n.title)).toEqual(['Keep']);
  });

  it('recurses into nested directories', async () => {
    await mkdir(join(tmp, 'Work', 'nested'), { recursive: true });
    await writeNote(join(tmp, 'Work', 'nested', 'deep.md'), '# Deep\n', new Date(2026, 0, 2));
    const notes = await listRecentNotes(tmp, 5);
    expect(notes.map((n) => n.title)).toContain('Deep');
  });
});
