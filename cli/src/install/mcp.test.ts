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

  it('creates file with vault-rag entry when absent', async () => {
    const result = await registerMcpServers({
      vaultPath: '/v',
      claudeJsonPath,
    });

    expect(result.added).toEqual(['vault-rag']);
    expect(result.skipped).toEqual([]);

    const data = await readJson(claudeJsonPath);
    expect(data.mcpServers?.['vault-rag']?.command).toBe('uv');
    expect(data.mcpServers?.['vault-rag']?.env?.VAULT_PATH).toBe('/v');
  });

  it('preserves existing mcpServers entries', async () => {
    await writeFile(
      claudeJsonPath,
      JSON.stringify({
        mcpServers: { 'other-server': { command: 'custom', args: ['--flag'] } },
        unrelatedKey: 'preserved',
      }),
      'utf8',
    );

    const result = await registerMcpServers({
      vaultPath: '/v',
      claudeJsonPath,
    });

    expect(result.added).toEqual(['vault-rag']);
    const data = await readJson(claudeJsonPath);
    expect(data.mcpServers?.['other-server']?.command).toBe('custom');
    expect(data.mcpServers?.['vault-rag']).toBeDefined();
    expect(data.unrelatedKey).toBe('preserved');
  });

  it('skips vault-rag when already present', async () => {
    await writeFile(
      claudeJsonPath,
      JSON.stringify({
        mcpServers: { 'vault-rag': { command: 'custom-uv', args: [] } },
      }),
      'utf8',
    );

    const result = await registerMcpServers({
      vaultPath: '/v',
      claudeJsonPath,
    });

    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(['vault-rag']);
    const data = await readJson(claudeJsonPath);
    expect(data.mcpServers?.['vault-rag']?.command).toBe('custom-uv');
  });

  it('adds serena when serenaDir supplied', async () => {
    const result = await registerMcpServers({
      vaultPath: '/v',
      serenaDir: '/Users/me/.serena/src/serena',
      claudeJsonPath,
    });

    expect(result.added).toEqual(['vault-rag', 'serena']);
    const data = await readJson(claudeJsonPath);
    expect(data.mcpServers?.serena?.command).toBe('uvx');
    expect(data.mcpServers?.serena?.args).toContain('/Users/me/.serena/src/serena');
  });

  it('sets teammateMode when enableTeams and absent', async () => {
    const result = await registerMcpServers({
      vaultPath: '/v',
      enableTeams: true,
      claudeJsonPath,
    });

    expect(result.teammateModeSet).toBe(true);
    const data = await readJson(claudeJsonPath);
    expect(data.teammateMode).toBe('auto');
  });

  it('preserves existing teammateMode', async () => {
    await writeFile(claudeJsonPath, JSON.stringify({ teammateMode: 'manual' }), 'utf8');

    const result = await registerMcpServers({
      vaultPath: '/v',
      enableTeams: true,
      claudeJsonPath,
    });

    expect(result.teammateModeSet).toBe(false);
    const data = await readJson(claudeJsonPath);
    expect(data.teammateMode).toBe('manual');
  });

  it('unregister removes named servers and preserves others', async () => {
    await registerMcpServers({
      vaultPath: '/v',
      serenaDir: '/s',
      claudeJsonPath,
    });
    await writeFile(
      claudeJsonPath,
      JSON.stringify({
        ...(await readJson(claudeJsonPath)),
        mcpServers: {
          ...(await readJson(claudeJsonPath)).mcpServers,
          'other-server': { command: 'custom' },
        },
      }),
      'utf8',
    );

    const result = await unregisterMcpServers({
      servers: ['vault-rag', 'serena'],
      claudeJsonPath,
    });

    expect(result.removed).toEqual(['vault-rag', 'serena']);
    const data = await readJson(claudeJsonPath);
    expect(data.mcpServers?.['vault-rag']).toBeUndefined();
    expect(data.mcpServers?.serena).toBeUndefined();
    expect(data.mcpServers?.['other-server']?.command).toBe('custom');
  });

  it('unregister reports missing servers under notPresent', async () => {
    await writeFile(claudeJsonPath, JSON.stringify({ mcpServers: {} }), 'utf8');
    const result = await unregisterMcpServers({
      servers: ['vault-rag'],
      claudeJsonPath,
    });
    expect(result.removed).toEqual([]);
    expect(result.notPresent).toEqual(['vault-rag']);
  });

  it('unregister on missing file is a no-op', async () => {
    const result = await unregisterMcpServers({
      servers: ['vault-rag'],
      claudeJsonPath,
    });
    expect(result.removed).toEqual([]);
    expect(result.notPresent).toEqual(['vault-rag']);
  });
});
