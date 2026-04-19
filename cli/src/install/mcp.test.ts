import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ClaudeJson, registerMcpServers, unregisterMcpServers } from './mcp.js';

async function readJson(path: string): Promise<ClaudeJson> {
  return JSON.parse(await readFile(path, 'utf8'));
}

describe('MCP registration', () => {
  let tmp: string;
  let claudeJsonPath: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-mcp-'));
    claudeJsonPath = join(tmp, '.claude.json');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('creates file with no servers when no optional features requested', async () => {
    const result = await registerMcpServers({ claudeJsonPath });

    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual([]);
    const data = await readJson(claudeJsonPath);
    expect(data.mcpServers).toEqual({});
  });

  it('strips legacy vault-rag entry on register', async () => {
    await writeFile(
      claudeJsonPath,
      JSON.stringify({
        mcpServers: { 'vault-rag': { command: 'uv', args: [] } },
      }),
      'utf8',
    );

    await registerMcpServers({ claudeJsonPath });
    const data = await readJson(claudeJsonPath);
    expect(data.mcpServers?.['vault-rag']).toBeUndefined();
  });

  it('preserves existing unrelated mcpServers entries', async () => {
    await writeFile(
      claudeJsonPath,
      JSON.stringify({
        mcpServers: { 'other-server': { command: 'custom', args: ['--flag'] } },
        unrelatedKey: 'preserved',
      }),
      'utf8',
    );

    await registerMcpServers({ claudeJsonPath });
    const data = await readJson(claudeJsonPath);
    expect(data.mcpServers?.['other-server']?.command).toBe('custom');
    expect(data.unrelatedKey).toBe('preserved');
  });

  it('adds serena entry pointing at the serena binary on PATH', async () => {
    const result = await registerMcpServers({ serena: true, claudeJsonPath });

    expect(result.added).toEqual(['serena']);
    const data = await readJson(claudeJsonPath);
    expect(data.mcpServers?.serena?.command).toBe('serena');
    expect(data.mcpServers?.serena?.args).toEqual(['start-mcp-server', '--context', 'claude-code']);
    expect(data.mcpServers?.serena?.env?.SERENA_USAGE_REPORTING).toBe('false');
  });

  it('sets teammateMode when enableTeams and absent', async () => {
    const result = await registerMcpServers({ enableTeams: true, claudeJsonPath });

    expect(result.teammateModeSet).toBe(true);
    const data = await readJson(claudeJsonPath);
    expect(data.teammateMode).toBe('auto');
  });

  it('preserves existing teammateMode', async () => {
    await writeFile(claudeJsonPath, JSON.stringify({ teammateMode: 'manual' }), 'utf8');

    const result = await registerMcpServers({ enableTeams: true, claudeJsonPath });

    expect(result.teammateModeSet).toBe(false);
    const data = await readJson(claudeJsonPath);
    expect(data.teammateMode).toBe('manual');
  });

  it('unregister removes named servers and preserves others', async () => {
    await writeFile(
      claudeJsonPath,
      JSON.stringify({
        mcpServers: {
          serena: { command: 'serena' },
          'other-server': { command: 'custom' },
        },
      }),
      'utf8',
    );

    const result = await unregisterMcpServers({
      servers: ['serena'],
      claudeJsonPath,
    });

    expect(result.removed).toEqual(['serena']);
    const data = await readJson(claudeJsonPath);
    expect(data.mcpServers?.serena).toBeUndefined();
    expect(data.mcpServers?.['other-server']?.command).toBe('custom');
  });

  it('unregister reports missing servers under notPresent', async () => {
    await writeFile(claudeJsonPath, JSON.stringify({ mcpServers: {} }), 'utf8');
    const result = await unregisterMcpServers({
      servers: ['serena'],
      claudeJsonPath,
    });
    expect(result.removed).toEqual([]);
    expect(result.notPresent).toEqual(['serena']);
  });

  it('unregister on missing file is a no-op', async () => {
    const result = await unregisterMcpServers({
      servers: ['serena'],
      claudeJsonPath,
    });
    expect(result.removed).toEqual([]);
    expect(result.notPresent).toEqual(['serena']);
  });
});
