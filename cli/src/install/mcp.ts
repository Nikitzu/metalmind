import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_CLAUDE_JSON = join(homedir(), '.claude.json');

export interface McpServerEntry {
  type?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ClaudeJson {
  mcpServers?: Record<string, McpServerEntry>;
  teammateMode?: string;
  [key: string]: unknown;
}

export interface RegisterMcpOptions {
  serena?: boolean;
  enableTeams?: boolean;
  claudeJsonPath?: string;
}

export interface RegisterMcpResult {
  claudeJsonPath: string;
  added: string[];
  skipped: string[];
  teammateModeSet: boolean;
}

export interface UnregisterMcpOptions {
  servers: string[];
  claudeJsonPath?: string;
  clearTeammateMode?: boolean;
}

export interface UnregisterMcpResult {
  claudeJsonPath: string;
  removed: string[];
  notPresent: string[];
}

async function readClaudeJson(path: string): Promise<ClaudeJson> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as ClaudeJson;
}

async function writeClaudeJson(path: string, data: ClaudeJson): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function buildSerenaEntry(): McpServerEntry {
  return {
    type: 'stdio',
    command: 'serena',
    args: ['start-mcp-server', '--context', 'claude-code'],
    env: { SERENA_USAGE_REPORTING: 'false' },
  };
}

export async function registerMcpServers(opts: RegisterMcpOptions): Promise<RegisterMcpResult> {
  const claudeJsonPath = opts.claudeJsonPath ?? DEFAULT_CLAUDE_JSON;
  const data = await readClaudeJson(claudeJsonPath);
  if (!data.mcpServers) data.mcpServers = {};
  const servers = data.mcpServers;

  const added: string[] = [];
  const skipped: string[] = [];

  if ('vault-rag' in servers) {
    delete servers['vault-rag'];
  }

  if (opts.serena) {
    if ('serena' in servers) {
      skipped.push('serena');
    } else {
      servers.serena = buildSerenaEntry();
      added.push('serena');
    }
  }

  let teammateModeSet = false;
  if (opts.enableTeams && !data.teammateMode) {
    data.teammateMode = 'auto';
    teammateModeSet = true;
  }

  await writeClaudeJson(claudeJsonPath, data);

  return { claudeJsonPath, added, skipped, teammateModeSet };
}

export async function unregisterMcpServers(
  opts: UnregisterMcpOptions,
): Promise<UnregisterMcpResult> {
  const claudeJsonPath = opts.claudeJsonPath ?? DEFAULT_CLAUDE_JSON;
  if (!existsSync(claudeJsonPath)) {
    return { claudeJsonPath, removed: [], notPresent: opts.servers };
  }
  const data = await readClaudeJson(claudeJsonPath);
  const servers = data.mcpServers ?? {};

  const removed: string[] = [];
  const notPresent: string[] = [];
  for (const name of opts.servers) {
    if (name in servers) {
      delete servers[name];
      removed.push(name);
    } else {
      notPresent.push(name);
    }
  }

  if (opts.clearTeammateMode && data.teammateMode !== undefined) {
    delete data.teammateMode;
  }

  await writeClaudeJson(claudeJsonPath, data);
  return { claudeJsonPath, removed, notPresent };
}
