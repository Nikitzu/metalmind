import { join } from 'node:path';
import { extractText, type McpToolResult, StdioMcpClient } from './mcp-client.js';

export type RecallTier = 'fast' | 'deep' | 'expand';

export interface RecallOptions {
  vaultPath: string;
  query: string;
  tier: RecallTier;
  k?: number;
}

export interface RecallResult {
  tool: string;
  text: string;
  raw: McpToolResult;
}

function vaultRagSpawn(vaultPath: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: 'uv',
    args: ['run', '--directory', join(vaultPath, '.claude-stack/vault_rag'), 'python', 'server.py'],
    env: { VAULT_PATH: vaultPath },
  };
}

export async function recall(opts: RecallOptions): Promise<RecallResult> {
  const client = new StdioMcpClient();
  try {
    await client.start(vaultRagSpawn(opts.vaultPath));

    if (opts.tier === 'expand') {
      const raw = await client.callTool('expand_search', { query: opts.query, k: opts.k ?? 5 });
      return { tool: 'expand_search', text: extractText(raw), raw };
    }

    const hits = await client.callTool('search_vault', { query: opts.query, k: opts.k ?? 5 });
    if (opts.tier === 'fast') {
      return { tool: 'search_vault', text: extractText(hits), raw: hits };
    }

    const topFile = extractFirstFile(extractText(hits));
    if (!topFile) {
      return { tool: 'search_vault', text: extractText(hits), raw: hits };
    }
    const deepRaw = await client.callTool('related_notes', { file: topFile });
    const merged: McpToolResult = {
      content: [
        ...(hits.content ?? []),
        { type: 'text', text: `\n--- related to ${topFile} ---\n` },
        ...(deepRaw.content ?? []),
      ],
    };
    return { tool: 'search_vault+related_notes', text: extractText(merged), raw: merged };
  } finally {
    await client.close();
  }
}

export function extractFirstFile(rendered: string): string | null {
  const match = rendered.match(/^([^\s:]+\.md):/m) ?? rendered.match(/^###?\s+([^\s]+\.md)/m);
  return match?.[1] ?? null;
}
