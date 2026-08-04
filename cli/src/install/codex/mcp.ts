// MCP server registration (opt-in via --with-mcp).
//
// Codex supports streamable HTTP MCP servers natively via `codex mcp add
// <name> --url <url>`. The metalmind watcher exposes /mcp at
// 127.0.0.1:17317 so this is a one-line registration.
//
// Off by default - registering an MCP server adds the tool's JSON schema
// to every Codex turn (~150-400 tokens), violating the "zero standing
// MCP-schema tax" headline rule. Users who specifically want explicit
// tool-call ergonomics opt in via --with-mcp.
//
// Idempotent via `codex mcp list --json` precheck. Returns
// 'codex-not-found' when the binary isn't on PATH so the caller can decide
// whether to hard-fail or warn-and-continue.

import { runCommand } from '../../util/exec.js';

export const DEFAULT_CODEX_MCP_NAME = 'metalmind';
export const DEFAULT_METALMIND_HTTP_URL = 'http://127.0.0.1:17317/mcp';

interface CodexMcpListEntry {
  name: string;
  url?: string;
  command?: string;
}

async function listCodexMcp(codexBin: string): Promise<CodexMcpListEntry[] | null> {
  const res = await runCommand(codexBin, ['mcp', 'list', '--json']);
  if (!res.ok) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed) ? (parsed as CodexMcpListEntry[]) : null;
  } catch {
    return null;
  }
}

export interface AddCodexMcpServerOptions {
  name?: string;
  url?: string;
  /** Override the codex binary path; defaults to `codex` on PATH. */
  codexBin?: string;
}

export interface AddCodexMcpServerResult {
  name: string;
  url: string;
  action: 'added' | 'already-present' | 'codex-not-found';
}

export async function addCodexMcpServer(
  opts: AddCodexMcpServerOptions = {},
): Promise<AddCodexMcpServerResult> {
  const name = opts.name ?? DEFAULT_CODEX_MCP_NAME;
  const url = opts.url ?? DEFAULT_METALMIND_HTTP_URL;
  const codexBin = opts.codexBin ?? 'codex';

  const list = await listCodexMcp(codexBin);
  if (list === null) return { name, url, action: 'codex-not-found' };
  if (list.some((entry) => entry.name === name && entry.url === url)) {
    return { name, url, action: 'already-present' };
  }
  if (list.some((entry) => entry.name === name)) {
    // Stale entry pointing elsewhere - remove first so we can re-add cleanly.
    // We surface the remove failure as part of the add error if the subsequent
    // add fails; otherwise the stale-remove failure is benign (Codex sometimes
    // returns non-zero on remove of an entry it then accepts as overwritten).
    const removeRes = await runCommand(codexBin, ['mcp', 'remove', name]);
    if (!removeRes.ok) {
      const addRes = await runCommand(codexBin, ['mcp', 'add', name, '--url', url]);
      if (!addRes.ok) {
        throw new Error(
          `codex mcp add failed (after stale-remove also failed: ${
            removeRes.stderr || removeRes.stdout
          }): ${addRes.stderr || addRes.stdout}`,
        );
      }
      return { name, url, action: 'added' };
    }
  }
  const res = await runCommand(codexBin, ['mcp', 'add', name, '--url', url]);
  if (!res.ok) {
    throw new Error(`codex mcp add failed: ${res.stderr || res.stdout}`);
  }
  return { name, url, action: 'added' };
}

export interface RemoveCodexMcpServerOptions {
  name?: string;
  codexBin?: string;
}

export interface RemoveCodexMcpServerResult {
  name: string;
  action: 'removed' | 'absent' | 'codex-not-found';
}

export async function removeCodexMcpServer(
  opts: RemoveCodexMcpServerOptions = {},
): Promise<RemoveCodexMcpServerResult> {
  const name = opts.name ?? DEFAULT_CODEX_MCP_NAME;
  const codexBin = opts.codexBin ?? 'codex';
  const list = await listCodexMcp(codexBin);
  if (list === null) return { name, action: 'codex-not-found' };
  if (!list.some((entry) => entry.name === name)) {
    return { name, action: 'absent' };
  }
  const res = await runCommand(codexBin, ['mcp', 'remove', name]);
  if (!res.ok) {
    throw new Error(`codex mcp remove failed: ${res.stderr || res.stdout}`);
  }
  return { name, action: 'removed' };
}
