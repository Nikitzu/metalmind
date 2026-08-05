import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
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
