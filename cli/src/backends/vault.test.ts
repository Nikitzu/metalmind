import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveToVault } from './vault.js';

describe('saveToVault', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-save-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes a timestamped file into Inbox/ with frontmatter', async () => {
    const now = new Date('2026-04-19T10:23:05Z');
    const result = await saveToVault({
      vaultPath: tmp,
      content: '# Auth rewrite decision\n\nUse JWT with refresh rotation.',
      now,
    });

    expect(result.filename).toMatch(/^2026-04-19-\d{6}-auth-rewrite-decision\.md$/);
    expect(existsSync(result.path)).toBe(true);
    expect(result.path.startsWith(join(tmp, 'Inbox'))).toBe(true);

    const contents = await readFile(result.path, 'utf8');
    expect(contents.startsWith('---\n')).toBe(true);
    expect(contents).toContain('title: Auth rewrite decision');
    expect(contents).toContain('created: 2026-04-19');
    expect(contents).toContain('status: draft');
    expect(contents).toContain('# Auth rewrite decision');
    expect(contents).toContain('Use JWT with refresh rotation.');
  });

  it('uses supplied title over inferred heading', async () => {
    const result = await saveToVault({
      vaultPath: tmp,
      content: 'raw content without heading',
      title: 'Custom Title',
      now: new Date('2026-04-19T12:00:00Z'),
    });

    expect(result.filename).toContain('custom-title');
    const contents = await readFile(result.path, 'utf8');
    expect(contents).toContain('title: Custom Title');
  });

  it('falls back to "note" slug when content has no text', async () => {
    const result = await saveToVault({
      vaultPath: tmp,
      content: '   ',
      now: new Date('2026-04-19T12:00:00Z'),
    });
    expect(result.filename).toMatch(/-note\.md$/);
  });

  it('creates Inbox/ when missing', async () => {
    expect(existsSync(join(tmp, 'Inbox'))).toBe(false);
    await saveToVault({
      vaultPath: tmp,
      content: 'first note',
      now: new Date('2026-04-19T12:00:00Z'),
    });
    expect(existsSync(join(tmp, 'Inbox'))).toBe(true);
  });

  it('dedups against an existing Inbox note with identical body', async () => {
    const content = 'a decision that should only be saved once';
    const first = await saveToVault({
      vaultPath: tmp,
      content,
      now: new Date('2026-04-19T10:00:00Z'),
    });
    expect(first.deduped).toBe(false);

    const second = await saveToVault({
      vaultPath: tmp,
      content,
      now: new Date('2026-04-19T11:00:00Z'),
    });
    expect(second.deduped).toBe(true);
    expect(second.path).toBe(first.path);
    expect(second.bytesWritten).toBe(0);
  });

  it('dedup ignores frontmatter differences — matches by body hash', async () => {
    const first = await saveToVault({
      vaultPath: tmp,
      content: 'shared body text',
      tags: ['one'],
      now: new Date('2026-04-19T10:00:00Z'),
    });
    const second = await saveToVault({
      vaultPath: tmp,
      content: 'shared body text',
      tags: ['two'],
      project: 'different',
      now: new Date('2026-04-19T11:00:00Z'),
    });
    expect(second.deduped).toBe(true);
    expect(second.path).toBe(first.path);
  });

  it('does not dedup when body differs', async () => {
    const first = await saveToVault({
      vaultPath: tmp,
      content: 'body A',
      now: new Date('2026-04-19T10:00:00Z'),
    });
    const second = await saveToVault({
      vaultPath: tmp,
      content: 'body B',
      now: new Date('2026-04-19T10:00:01Z'),
    });
    expect(second.deduped).toBe(false);
    expect(second.path).not.toBe(first.path);
  });

  it('includes project frontmatter when supplied', async () => {
    const result = await saveToVault({
      vaultPath: tmp,
      content: 'deploying',
      project: 'metalmind',
      tags: ['decision', 'deploy'],
      now: new Date('2026-04-19T12:00:00Z'),
    });
    const contents = await readFile(result.path, 'utf8');
    expect(contents).toContain('project: metalmind');
    expect(contents).toContain('tags: ["decision", "deploy"]');
  });
});
