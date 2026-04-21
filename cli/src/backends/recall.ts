import { extractText, type McpToolResult, StdioMcpClient } from './mcp-client.js';

export type RecallTier = 'fast' | 'deep' | 'expand';

export interface RecallOptions {
  vaultPath: string;
  query: string;
  tier: RecallTier;
  k?: number;
  /** When true, ask the HTTP endpoint to run a cross-encoder reranker over the
   *  top-N hits before returning top-k. Opt-in. Silent no-op on stdio fallback
   *  (the reranker lives in the watcher's HTTP server). */
  rerank?: boolean;
  /** When true, log the HTTP-path failure to stderr before falling back. */
  verbose?: boolean;
  /** Override the co-hosted HTTP recall endpoint. Defaults to env or config. */
  httpEndpoint?: string | null;
}

export interface RecallResult {
  tool: string;
  text: string;
  raw: McpToolResult;
  /** Transport used — 'http' is the fast local path, 'stdio' is the MCP fallback. */
  transport: 'http' | 'stdio';
}

const DEFAULT_HTTP_ENDPOINT = 'http://127.0.0.1:17317';
// Ollama cold-start + embed of the query can exceed 2s on the first call.
// 6s covers a cold local host without starving the stdio fallback on a real
// outage (we still fall through after the timeout).
const HTTP_TIMEOUT_MS = 6_000;

function resolveEndpoint(override?: string | null): string {
  return override || process.env.METALMIND_RECALL_HTTP || DEFAULT_HTTP_ENDPOINT;
}

function vaultRagSpawn(vaultPath: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: 'metalmind-vault-rag-server',
    args: [],
    env: { VAULT_PATH: vaultPath },
  };
}

async function httpPost(endpoint: string, path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function rawFromText(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function formatHits(hits: Array<Record<string, unknown>>): string {
  return hits.map((h) => JSON.stringify(h, null, 2)).join('\n');
}

async function httpRecall(opts: RecallOptions): Promise<RecallResult | null> {
  const endpoint = resolveEndpoint(opts.httpEndpoint);
  try {
    if (opts.tier === 'expand') {
      const body = (await httpPost(endpoint, '/expand', {
        query: opts.query,
        k: opts.k ?? 5,
      })) as {
        hits: Array<Record<string, unknown>>;
        expansions: unknown[];
      };
      const text = `${formatHits(body.hits)}\n---expansions---\n${JSON.stringify(body.expansions, null, 2)}`;
      return { tool: 'http:expand', text, raw: rawFromText(text), transport: 'http' };
    }

    const hits = (await httpPost(endpoint, '/search', {
      query: opts.query,
      k: opts.k ?? 5,
      rerank: opts.rerank ?? false,
    })) as { hits: Array<Record<string, unknown>> };
    if (opts.tier === 'fast') {
      const text = formatHits(hits.hits);
      return { tool: 'http:search', text, raw: rawFromText(text), transport: 'http' };
    }

    // deep tier: search then related_notes on the top hit
    const topFile = (hits.hits[0]?.file as string | undefined) ?? null;
    if (!topFile) {
      const text = formatHits(hits.hits);
      return { tool: 'http:search', text, raw: rawFromText(text), transport: 'http' };
    }
    const related = await httpPost(endpoint, '/related', { file: topFile });
    const text = `${formatHits(hits.hits)}\n---related to ${topFile}---\n${JSON.stringify(related, null, 2)}`;
    return { tool: 'http:search+related', text, raw: rawFromText(text), transport: 'http' };
  } catch (err) {
    if (opts.verbose) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `recall: HTTP path ${endpoint} failed (${message}); falling back to stdio MCP\n`,
      );
    }
    return null;
  }
}

async function stdioRecall(opts: RecallOptions): Promise<RecallResult> {
  const client = new StdioMcpClient();
  try {
    await client.start(vaultRagSpawn(opts.vaultPath));

    if (opts.tier === 'expand') {
      const raw = await client.callTool('expand_search', { query: opts.query, k: opts.k ?? 5 });
      return {
        tool: 'stdio:expand_search',
        text: extractText(raw),
        raw,
        transport: 'stdio',
      };
    }

    const hits = await client.callTool('search_vault', { query: opts.query, k: opts.k ?? 5 });
    if (opts.tier === 'fast') {
      return { tool: 'stdio:search_vault', text: extractText(hits), raw: hits, transport: 'stdio' };
    }

    const topFile = extractFirstFile(extractText(hits));
    if (!topFile) {
      return { tool: 'stdio:search_vault', text: extractText(hits), raw: hits, transport: 'stdio' };
    }
    const deepRaw = await client.callTool('related_notes', { file: topFile });
    const merged: McpToolResult = {
      content: [
        ...(hits.content ?? []),
        { type: 'text', text: `\n--- related to ${topFile} ---\n` },
        ...(deepRaw.content ?? []),
      ],
    };
    return {
      tool: 'stdio:search_vault+related_notes',
      text: extractText(merged),
      raw: merged,
      transport: 'stdio',
    };
  } finally {
    await client.close();
  }
}

export async function recall(opts: RecallOptions): Promise<RecallResult> {
  // Try the long-running HTTP endpoint co-hosted in the watcher first. Most
  // calls land here (sub-20ms). If the watcher isn't up, or the endpoint is
  // unreachable for any reason, fall back to spawning a per-call MCP server
  // over stdio (the slower but always-available path).
  const http = await httpRecall(opts);
  if (http) return http;
  return stdioRecall(opts);
}

export function extractFirstFile(rendered: string): string | null {
  const match = rendered.match(/^([^\s:]+\.md):/m) ?? rendered.match(/^###?\s+([^\s]+\.md)/m);
  return match?.[1] ?? null;
}
