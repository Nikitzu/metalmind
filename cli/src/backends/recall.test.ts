import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractFirstFile, recall } from './recall.js';

describe('extractFirstFile', () => {
  it('parses filename:score rendering', () => {
    const input = 'auth-flow.md: 0.87\nother-note.md: 0.62\n';
    expect(extractFirstFile(input)).toBe('auth-flow.md');
  });

  it('parses ### heading rendering', () => {
    const input = '### auth-flow.md\n\nexcerpt...';
    expect(extractFirstFile(input)).toBe('auth-flow.md');
  });

  it('returns null when no markdown file found', () => {
    expect(extractFirstFile('no matches')).toBeNull();
  });
});

describe('recall transport selection', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uses the HTTP transport when the local endpoint answers', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hits: [{ file: 'decisions/auth.md', heading: '(root)', score: 0.9, text: 'bcrypt' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    const res = await recall({
      vaultPath: '/tmp/vault',
      query: 'bcrypt decision',
      tier: 'fast',
    });

    expect(res.transport).toBe('http');
    expect(res.tool).toBe('http:search');
    expect(res.text).toContain('decisions/auth.md');
  });

  it('--verify-code annotates hits whose code refs are stale', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'mm-recall-vault-'));
    await mkdir(join(vault, 'Plans'), { recursive: true });
    await writeFile(
      join(vault, 'Plans', 'stale.md'),
      '---\ncode: ["ghost-repo#gone"]\n---\n\nbody\n',
    );
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hits: [{ file: 'Plans/stale.md', heading: '(root)', score: 0.9, text: 'stale note' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    const res = await recall({
      vaultPath: vault,
      query: 'q',
      tier: 'fast',
      compact: true,
      verifyCode: true,
      forgeGroups: {},
    });

    expect(res.text).toContain('⚠ code ref unresolvable-repo: ghost-repo#gone');
    await rm(vault, { recursive: true, force: true });
  });

  it('--verify-code flags a missing ref and leaves a resolving ref unannotated', async () => {
    const { mkdtemp: mk } = await import('node:fs/promises');
    const vault = await mk(join(tmpdir(), 'mm-recall-vault-'));
    const repo = await mk(join(tmpdir(), 'mm-recall-repo-'));
    await writeFile(join(repo, 'lib.ts'), 'export function liveSymbol() {}\n');
    const repoName = repo.split('/').pop() as string;
    await mkdir(join(vault, 'Plans'), { recursive: true });
    await writeFile(
      join(vault, 'Plans', 'good.md'),
      `---\ncode: ["${repoName}#liveSymbol"]\n---\n\nbody\n`,
    );
    await writeFile(
      join(vault, 'Plans', 'bad.md'),
      `---\ncode: ["${repoName}#renamedAway"]\n---\n\nbody\n`,
    );
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hits: [
              { file: 'Plans/good.md', heading: '(root)', score: 0.9, text: 'good' },
              { file: 'Plans/bad.md', heading: '(root)', score: 0.8, text: 'bad' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    const res = await recall({
      vaultPath: vault,
      query: 'q',
      tier: 'fast',
      compact: true,
      verifyCode: true,
      forgeGroups: { g: { repos: [repo] } },
    });

    expect(res.text).toContain(`⚠ code ref missing: ${repoName}#renamedAway`);
    expect(res.text).not.toContain(`⚠ code ref missing: ${repoName}#liveSymbol`);
    await rm(vault, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it('without --verify-code no code-ref work happens and output is unannotated', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'mm-recall-vault-'));
    await mkdir(join(vault, 'Plans'), { recursive: true });
    await writeFile(
      join(vault, 'Plans', 'bad.md'),
      '---\ncode: ["ghost-repo#gone"]\n---\n\nbody\n',
    );
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hits: [{ file: 'Plans/bad.md', heading: '(root)', score: 0.9, text: 'bad' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    const res = await recall({ vaultPath: vault, query: 'q', tier: 'fast', compact: true });

    expect(res.text).not.toContain('code ref');
    await rm(vault, { recursive: true, force: true });
  });

  it('returns structured hits carrying code_refs for --json consumers', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'mm-recall-vault-'));
    await mkdir(join(vault, 'Plans'), { recursive: true });
    await writeFile(
      join(vault, 'Plans', 'stale.md'),
      '---\ncode: ["ghost-repo#gone"]\n---\n\nbody\n',
    );
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hits: [{ file: 'Plans/stale.md', heading: '(root)', score: 0.9, text: 'stale' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    const res = await recall({
      vaultPath: vault,
      query: 'q',
      tier: 'fast',
      verifyCode: true,
      forgeGroups: {},
    });

    expect(res.hits?.[0]?.code_refs).toEqual([
      { ref: 'ghost-repo#gone', status: 'unresolvable-repo', detail: expect.any(String) },
    ]);
    await rm(vault, { recursive: true, force: true });
  });

  it('compact output renders the superseded_by pointer on the hit line', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hits: [
              {
                file: 'Plans/old.md',
                heading: '(root)',
                score: 0.4,
                text: 'stale plan',
                superseded_by: '2026-08-05-new-plan',
              },
              { file: 'Plans/new.md', heading: '(root)', score: 0.9, text: 'current plan' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    const res = await recall({
      vaultPath: '/tmp/vault',
      query: 'plan',
      tier: 'fast',
      compact: true,
    });

    expect(res.text).toContain('→ superseded by [[2026-08-05-new-plan]]');
    expect(res.text).not.toContain('Plans/new.md › (root) →');
  });

  it('sends the requested search mode in the /search body', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ hits: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await recall({
      vaultPath: '/tmp/vault',
      query: 'exact filename',
      tier: 'fast',
      mode: 'keyword-only',
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.mode).toBe('keyword-only');
  });

  it('defaults the /search mode to hybrid', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ hits: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await recall({ vaultPath: '/tmp/vault', query: 'anything', tier: 'fast' });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.mode).toBe('hybrid');
  });

  it('falls back to stdio MCP when HTTP is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;

    // Mock the stdio client so we don't spawn anything.
    const { StdioMcpClient } = await import('./mcp-client.js');
    vi.spyOn(StdioMcpClient.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(StdioMcpClient.prototype, 'callTool').mockResolvedValue({
      content: [{ type: 'text', text: 'fallback.md: 0.5\nfoo' }],
    });
    vi.spyOn(StdioMcpClient.prototype, 'close').mockResolvedValue(undefined);

    const res = await recall({
      vaultPath: '/tmp/vault',
      query: 'cold path',
      tier: 'fast',
    });

    expect(res.transport).toBe('stdio');
    expect(res.tool).toBe('stdio:search_vault');
    expect(res.text).toContain('fallback.md');
  });

  it('falls back to stdio when HTTP returns a non-OK status', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('server error', { status: 500 }),
    ) as typeof fetch;

    const { StdioMcpClient } = await import('./mcp-client.js');
    vi.spyOn(StdioMcpClient.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(StdioMcpClient.prototype, 'callTool').mockResolvedValue({
      content: [{ type: 'text', text: 'ok.md: 0.5' }],
    });
    vi.spyOn(StdioMcpClient.prototype, 'close').mockResolvedValue(undefined);

    const res = await recall({ vaultPath: '/tmp/vault', query: 'q', tier: 'fast' });
    expect(res.transport).toBe('stdio');
  });
});

describe('recall output shaping (--files, --budget, --neighbors)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const hitsResponse = (hits: unknown[]) =>
    vi.fn(
      async () =>
        new Response(JSON.stringify({ hits }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as typeof fetch;

  it('--files renders path plus frontmatter title and no snippet text', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'mm-recall-files-'));
    await mkdir(join(vault, 'Work'), { recursive: true });
    await writeFile(
      join(vault, 'Work', 'auth.md'),
      '---\ntitle: Auth model decision\n---\n\nlong body that must not appear\n',
    );
    globalThis.fetch = hitsResponse([
      {
        file: 'Work/auth.md',
        heading: 'Auth model / Sessions',
        score: 0.91,
        text: 'long body that must not appear',
      },
    ]);

    const res = await recall({ vaultPath: vault, query: 'auth', tier: 'fast', files: true });

    expect(res.text).toContain('Work/auth.md - Auth model decision');
    expect(res.text).not.toContain('long body');
    await rm(vault, { recursive: true, force: true });
  });

  it('--files falls back to the first heading segment when the note is unreadable', async () => {
    globalThis.fetch = hitsResponse([
      { file: 'Gone/missing.md', heading: 'Missing note title / Sub', score: 0.5, text: 'body' },
    ]);

    const res = await recall({ vaultPath: '/nonexistent', query: 'q', tier: 'fast', files: true });

    expect(res.text).toContain('Gone/missing.md - Missing note title');
    expect(res.text).not.toContain('body');
  });

  it('--budget keeps every hit with shrunk snippets when they fit', async () => {
    const longText = 'word '.repeat(200);
    globalThis.fetch = hitsResponse([
      { file: 'a.md', heading: '(root)', score: 0.9, text: longText },
      { file: 'b.md', heading: '(root)', score: 0.8, text: longText },
      { file: 'c.md', heading: '(root)', score: 0.7, text: longText },
    ]);

    const res = await recall({
      vaultPath: '/tmp/vault',
      query: 'q',
      tier: 'fast',
      budgetTokens: 150,
    });

    expect(res.text.length).toBeLessThanOrEqual(150 * 4);
    expect(res.text).toContain('a.md');
    expect(res.text).toContain('c.md');
  });

  it('--budget drops trailing hits only when the smallest snippet still overflows', async () => {
    const longText = 'word '.repeat(200);
    globalThis.fetch = hitsResponse(
      Array.from({ length: 5 }, (_, i) => ({
        file: `note-${i}.md`,
        heading: '(root)',
        score: 0.9 - i / 10,
        text: longText,
      })),
    );

    const res = await recall({
      vaultPath: '/tmp/vault',
      query: 'q',
      tier: 'fast',
      budgetTokens: 60,
    });

    expect(res.text.length).toBeLessThanOrEqual(60 * 4);
    expect(res.text).toContain('note-0.md');
    expect(res.text).not.toContain('note-4.md');
  });

  it('--neighbors sends the field and renders prev/next under the hit', async () => {
    const fetchMock = hitsResponse([
      {
        file: 'a.md',
        heading: '(root)',
        score: 0.9,
        text: 'the chunk itself',
        neighbor_text: { prev: 'text before the chunk', next: 'text after the chunk' },
      },
    ]);
    globalThis.fetch = fetchMock;

    const res = await recall({
      vaultPath: '/tmp/vault',
      query: 'q',
      tier: 'fast',
      compact: true,
      neighbors: true,
    });

    const call = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body.neighbors).toBe(true);
    expect(res.text).toContain('↳ prev: text before the chunk');
    expect(res.text).toContain('↳ next: text after the chunk');
  });

  it('tolerates a watcher that ignores the neighbors field', async () => {
    globalThis.fetch = hitsResponse([
      { file: 'a.md', heading: '(root)', score: 0.9, text: 'plain hit' },
    ]);

    const res = await recall({
      vaultPath: '/tmp/vault',
      query: 'q',
      tier: 'fast',
      compact: true,
      neighbors: true,
    });

    expect(res.text).toContain('plain hit');
    expect(res.text).not.toContain('↳');
  });

  it('default output is unchanged when no shaping flag is passed', async () => {
    globalThis.fetch = hitsResponse([
      { file: 'a.md', heading: '(root)', score: 0.9, text: 'chunk' },
    ]);

    const res = await recall({ vaultPath: '/tmp/vault', query: 'q', tier: 'fast' });

    expect(res.text).toBe(
      JSON.stringify({ file: 'a.md', heading: '(root)', score: 0.9, text: 'chunk' }, null, 2),
    );
  });
});
