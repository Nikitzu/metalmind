import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installCursor, uninstallCursor } from './orchestrator.js';

describe('installCursor', () => {
  it('installs skills, agents, hook and is reversible', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const result = await installCursor({ vaultPath: '/tmp/v', flavor: 'scadrial', cursorDir });
    expect(result.skills).toContain('metalmind-recall');
    expect(result.agents.length).toBeGreaterThanOrEqual(15);
    expect(result.hookScript).not.toBe('unchanged');
    expect(existsSync(join(cursorDir, 'hooks.json'))).toBe(true);
    expect(result.mcp).toBe('skipped');

    const un = await uninstallCursor({ cursorDir });
    expect(un.skills).toContain('metalmind-recall');
    expect(un.hooksJson).toBe(true);
  });

  it('--with-mcp registers the MCP server', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const result = await installCursor({
      vaultPath: '/tmp/v',
      flavor: 'scadrial',
      cursorDir,
      withMcp: true,
    });
    expect(result.mcp).toBe('added');
  });
});
