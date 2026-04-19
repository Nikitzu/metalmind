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
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hits: [
            { file: 'decisions/auth.md', heading: '(root)', score: 0.9, text: 'bcrypt' },
          ],
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
    globalThis.fetch = vi.fn(async () =>
      new Response('server error', { status: 500 }),
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
