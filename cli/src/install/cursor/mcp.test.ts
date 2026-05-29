import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCursorMcpServer, removeCursorMcpServer } from './mcp.js';

describe('cursor mcp', () => {
  it('adds metalmind server without clobbering existing servers', async () => {
    const mcpJsonPath = join(mkdtempSync(join(tmpdir(), 'mm-cursor-')), 'mcp.json');
    writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: { other: { url: 'x' } } }));
    const result = await addCursorMcpServer({ mcpJsonPath });
    expect(result.action).toBe('added');
    const data = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
    expect(data.mcpServers.other).toBeDefined();
    expect(data.mcpServers.metalmind).toBeDefined();
  });

  it('is idempotent', async () => {
    const mcpJsonPath = join(mkdtempSync(join(tmpdir(), 'mm-cursor-')), 'mcp.json');
    await addCursorMcpServer({ mcpJsonPath });
    const second = await addCursorMcpServer({ mcpJsonPath });
    expect(second.action).toBe('already-present');
  });

  it('removeCursorMcpServer deletes only the metalmind entry', async () => {
    const mcpJsonPath = join(mkdtempSync(join(tmpdir(), 'mm-cursor-')), 'mcp.json');
    writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: { other: { url: 'x' } } }));
    await addCursorMcpServer({ mcpJsonPath });
    const result = await removeCursorMcpServer({ mcpJsonPath });
    expect(result.action).toBe('removed');
    const data = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
    expect(data.mcpServers.other).toBeDefined();
    expect(data.mcpServers.metalmind).toBeUndefined();
  });
});
