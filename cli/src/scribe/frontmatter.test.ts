import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFrontmatter, readNoteFrontmatter, splitFrontmatter } from './frontmatter.js';

describe('splitFrontmatter', () => {
  it('splits a normal note into raw frontmatter and body', () => {
    const src = '---\ntitle: x\n---\n\nbody text\n';
    const r = splitFrontmatter(src);
    expect(r.raw).toBe('title: x');
    expect(r.body).toBe('\nbody text\n');
    expect(src.slice(r.bodyStart)).toBe(r.body);
  });

  it('treats a note without frontmatter as all body', () => {
    const src = '# just a heading\n';
    const r = splitFrontmatter(src);
    expect(r.raw).toBe('');
    expect(r.bodyStart).toBe(0);
    expect(r.body).toBe(src);
  });

  it('does not mistake a horizontal rule in the body for a closing fence', () => {
    const src = '---\ntitle: x\n---\n\nintro\n\n---\n\nafter the rule\n';
    const r = splitFrontmatter(src);
    expect(r.raw).toBe('title: x');
    expect(r.body).toContain('after the rule');
  });
});

describe('parseFrontmatter', () => {
  it('strips quotes from values instead of keeping them literally', () => {
    const { fm } = parseFrontmatter('---\nsuperseded_by: "RED-4821: retry backoff"\n---\n\nb\n');
    expect(fm.superseded_by).toBe('RED-4821: retry backoff');
  });

  it('reads a block-sequence list the way Obsidian writes it', () => {
    const { fm } = parseFrontmatter(
      '---\ncode:\n  - metalmind#foo\n  - driver-app#useBar\n---\n\nb\n',
    );
    expect(fm.code).toEqual(['metalmind#foo', 'driver-app#useBar']);
  });

  it('reads an inline flow list', () => {
    const { fm } = parseFrontmatter('---\ncode: ["metalmind#foo"]\n---\n\nb\n');
    expect(fm.code).toEqual(['metalmind#foo']);
  });

  it('reads a value written on the line below its key', () => {
    const { fm } = parseFrontmatter('---\nstatus:\n  superseded\n---\n\nb\n');
    expect(fm.status).toBe('superseded');
  });

  it('does not let a multi-line scalar leak a nested key', () => {
    const src =
      '---\nsummary: |\n  a block scalar\n  status: superseded\nstatus: active\n---\n\nb\n';
    const { fm } = parseFrontmatter(src);
    expect(fm.status).toBe('active');
    expect(String(fm.summary)).toContain('status: superseded');
  });

  it('returns empty frontmatter rather than throwing on malformed YAML', () => {
    const { fm } = parseFrontmatter('---\n: : :\n  bad\n---\n\nb\n');
    expect(fm).toEqual({});
  });
});

describe('readNoteFrontmatter', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mm-fm-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads frontmatter that extends past the old 2 KB slice', async () => {
    const filler = Array.from({ length: 90 }, (_, i) => `tag_${i}: "${'x'.repeat(30)}"`).join('\n');
    const p = join(dir, 'big.md');
    await writeFile(
      p,
      `---\n${filler}\nstatus: superseded\nsuperseded_by: successor\n---\n\nbody\n`,
    );

    const fm = await readNoteFrontmatter(p);

    expect(fm.superseded_by).toBe('successor');
    expect(fm.status).toBe('superseded');
  });

  it('returns empty for a missing file and for a note with no frontmatter', async () => {
    expect(await readNoteFrontmatter(join(dir, 'nope.md'))).toEqual({});
    const p = join(dir, 'plain.md');
    await writeFile(p, '# no frontmatter\n');
    expect(await readNoteFrontmatter(p)).toEqual({});
  });
});
