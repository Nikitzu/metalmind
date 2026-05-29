// Opt-in MCP registration for Cursor (~/.cursor/mcp.json).
//
// metalmind's recall thesis is bash-over-loopback, NOT MCP — this is the
// fallback for users who explicitly want the tool-call shape (--with-mcp).
// Cursor reads mcp.json; we edit it directly, no CLI dependency.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_CURSOR_DIR } from './shared.js';

const METALMIND_MCP_KEY = 'metalmind';
const METALMIND_MCP_URL = 'http://127.0.0.1:17317/mcp';

interface McpJsonFile {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

async function readMcpJson(path: string): Promise<McpJsonFile> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as McpJsonFile;
}

async function writeMcpJson(path: string, data: McpJsonFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export interface CursorMcpOptions {
  mcpJsonPath?: string;
}

export async function addCursorMcpServer(
  opts: CursorMcpOptions = {},
): Promise<{ action: 'added' | 'already-present' }> {
  const mcpJsonPath = opts.mcpJsonPath ?? join(DEFAULT_CURSOR_DIR, 'mcp.json');
  const data = await readMcpJson(mcpJsonPath);
  const servers = data.mcpServers ?? {};
  if (servers[METALMIND_MCP_KEY]) return { action: 'already-present' };
  servers[METALMIND_MCP_KEY] = { url: METALMIND_MCP_URL };
  data.mcpServers = servers;
  await writeMcpJson(mcpJsonPath, data);
  return { action: 'added' };
}

export async function removeCursorMcpServer(
  opts: CursorMcpOptions = {},
): Promise<{ action: 'removed' | 'absent' }> {
  const mcpJsonPath = opts.mcpJsonPath ?? join(DEFAULT_CURSOR_DIR, 'mcp.json');
  if (!existsSync(mcpJsonPath)) return { action: 'absent' };
  const data = await readMcpJson(mcpJsonPath);
  if (!data.mcpServers?.[METALMIND_MCP_KEY]) return { action: 'absent' };
  delete data.mcpServers[METALMIND_MCP_KEY];
  if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
  if (Object.keys(data).length === 0) await unlink(mcpJsonPath);
  else await writeMcpJson(mcpJsonPath, data);
  return { action: 'removed' };
}
