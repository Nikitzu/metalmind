import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type CodeRefStatus,
  checkSymbol,
  parseCodeRef,
  parseCodeRefsFromHead,
  resolveRepoPath,
  verifyCodeRefs,
} from './coderefs.js';

describe('parseCodeRef', () => {
  it('accepts repo#symbol with identifier symbols', () => {
    expect(parseCodeRef('metalmind#resolveNotePath')).toEqual({
      repo: 'metalmind',
      symbol: 'resolveNotePath',
      raw: 'metalmind#resolveNotePath',
    });
  });

  it('rejects malformed refs', () => {
    expect(parseCodeRef('no-hash')).toBeNull();
    expect(parseCodeRef('repo#not an identifier')).toBeNull();
    expect(parseCodeRef('repo#a.b')).toBeNull();
    expect(parseCodeRef('#sym')).toBeNull();
  });
});

describe('parseCodeRefsFromHead', () => {
  it('reads the inline code list scribe writes', () => {
    const head = '---\ntitle: x\ncode: ["metalmind#foo", "driver-app#useBar"]\n---\n\nbody';
    expect(parseCodeRefsFromHead(head)).toEqual(['metalmind#foo', 'driver-app#useBar']);
  });

  it('returns empty for absent field or no frontmatter', () => {
    expect(parseCodeRefsFromHead('---\ntitle: x\n---\nbody')).toEqual([]);
    expect(parseCodeRefsFromHead('no frontmatter')).toEqual([]);
  });
});

describe('resolveRepoPath', () => {
  it('matches by basename across groups in deterministic order', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'mm-coderefs-'));
    await mkdir(join(tmp, 'a', 'metalmind'), { recursive: true });
    await mkdir(join(tmp, 'b', 'metalmind'), { recursive: true });
    const groups = {
      zeta: { repos: [join(tmp, 'b', 'metalmind')] },
      alpha: { repos: [join(tmp, 'a', 'metalmind')] },
    };

    expect(resolveRepoPath('metalmind', groups)).toBe(join(tmp, 'a', 'metalmind'));
    expect(resolveRepoPath('unknown', groups)).toBeNull();
    await rm(tmp, { recursive: true, force: true });
  });
});

describe('parseCodeRefsFromHead block form', () => {
  it('reads the Obsidian block-sequence form', () => {
    const head = '---\ntitle: x\ncode:\n  - metalmind#foo\n  - "driver-app#useBar"\n---\n\nbody';
    expect(parseCodeRefsFromHead(head)).toEqual(['metalmind#foo', 'driver-app#useBar']);
  });

  it('reads a single-quoted inline list via the fallback parse', () => {
    const head = "---\ncode: ['metalmind#foo']\n---\n\nbody";
    expect(parseCodeRefsFromHead(head)).toEqual(['metalmind#foo']);
  });
});

describe('checkSymbol + verifyCodeRefs', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'mm-fake-repo-'));
    await writeFile(join(repo, 'lib.ts'), 'export function realSymbol(x: number) { return x; }\n');
    await writeFile(join(repo, 'mention.md'), 'talks about ghostSymbol in prose only\n');
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('finds a definition-shaped symbol (auto and grep paths)', async () => {
    for (const tool of ['auto', 'grep'] as const) {
      const res = await checkSymbol(repo, 'realSymbol', { tool });
      expect(res.status).toBe('ok');
    }
  });

  it('finds a $-prefixed symbol (regex metachars escaped)', async () => {
    await writeFile(join(repo, 'store.ts'), 'export const $store = 1;\n');
    const res = await checkSymbol(repo, '$store', { tool: 'grep' });
    expect(res.status).toBe('ok');
  });

  it('ignores symbols that live only in skipped directories', async () => {
    await mkdir(join(repo, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(
      join(repo, 'node_modules', 'pkg', 'index.js'),
      'export function vendoredOnly() {}\n',
    );
    const res = await checkSymbol(repo, 'vendoredOnly', { tool: 'grep' });
    expect(res.status).toBe('missing');
  });

  it('reports a timeout as unresolvable-repo rather than missing', async () => {
    const res = await checkSymbol(repo, 'realSymbol', { tool: 'grep', timeoutMs: 1 });
    if (res.status !== 'ok') {
      expect(res.status).toBe('unresolvable-repo');
      expect(res.detail).toMatch(/timed out|failed/);
    }
  });

  it('respects an exhausted shared deadline', async () => {
    const results = await verifyCodeRefs(
      [`${basename(repo)}#realSymbol`],
      { g: { repos: [repo] } },
      {
        deadline: Date.now() - 1,
      },
    );
    expect(results[0]?.status).toBe('unresolvable-repo');
    expect(results[0]?.detail).toContain('budget exhausted');
  });

  it('skips a registered repo path that no longer exists', async () => {
    const results = await verifyCodeRefs([`${basename(repo)}#realSymbol`], {
      a: { repos: [join(repo, 'gone-forever')] },
      b: { repos: [repo] },
    });
    expect(results[0]?.status).toBe('ok');
  });

  it('distinguishes a real definition from a call-site-only match', async () => {
    await writeFile(join(repo, 'caller.ts'), 'deletedSymbol(1, 2);\nconst x = deletedSymbol;\n');
    const res = await checkSymbol(repo, 'deletedSymbol', { tool: 'grep' });
    expect(res.status).toBe('ok');
    expect(res.detail).toMatch(/reference/i);

    const real = await checkSymbol(repo, 'realSymbol', { tool: 'grep' });
    expect(real.status).toBe('ok');
    expect(real.detail).toBeUndefined();
  });

  it('treats a Go func declaration as a definition, not a bare reference', async () => {
    await writeFile(join(repo, 'main.go'), 'func GoHandler(w http.ResponseWriter) {}\n');
    const res = await checkSymbol(repo, 'GoHandler', { tool: 'grep' });
    expect(res.status).toBe('ok');
    expect(res.detail).toBeUndefined();
  });

  it('memoises repeated (repo, symbol) lookups within a run', async () => {
    const cache = new Map<string, { status: CodeRefStatus; detail?: string }>();
    const groups = { g: { repos: [repo] } };
    const ref = `${basename(repo)}#realSymbol`;

    const first = await verifyCodeRefs([ref], groups, { cache });
    const second = await verifyCodeRefs([ref], groups, { cache });

    expect(first[0]?.status).toBe('ok');
    expect(second[0]?.status).toBe('ok');
    expect(cache.size).toBe(1);
  });

  it('reports missing when only prose mentions exist', async () => {
    const res = await checkSymbol(repo, 'ghostSymbol', { tool: 'grep' });
    expect(res.status).toBe('missing');
  });

  it('verifyCodeRefs maps statuses per ref', async () => {
    const groups = { g: { repos: [repo] } };
    const results = await verifyCodeRefs(
      [`${basename(repo)}#realSymbol`, 'nowhere#foo', 'bad ref'],
      groups,
    );
    expect(results[0]?.status).toBe('ok');
    expect(results[1]?.status).toBe('unresolvable-repo');
    expect(results[2]?.status).toBe('unresolvable-repo');
    expect(results[2]?.detail).toContain('malformed');
  });
});
