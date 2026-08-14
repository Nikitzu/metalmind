import { join } from 'node:path';
import {
  type CodeRefResult,
  type ForgeGroups,
  parseCodeRefsFromHead,
  verifyCodeRefs,
} from '../coderefs/coderefs.js';
import { extractText, type McpToolResult, StdioMcpClient } from './mcp-client.js';
import { recallAuthHeaders } from './recall-token.js';

export type RecallTier = 'fast' | 'deep' | 'expand';

export type RecallMode = 'hybrid' | 'semantic-only' | 'keyword-only';

export interface RecallOptions {
  vaultPath: string;
  query: string;
  tier: RecallTier;
  k?: number;
  /** When true, ask the HTTP endpoint to run a cross-encoder reranker over the
   *  top-N hits before returning top-k. Opt-in. Silent no-op on stdio fallback
   *  (the reranker lives in the watcher's HTTP server). */
  rerank?: boolean;
  mode?: RecallMode;
  /** When true, log the HTTP-path failure to stderr before falling back. */
  verbose?: boolean;
  compact?: boolean;
  files?: boolean;
  budgetTokens?: number;
  neighbors?: boolean;
  verifyCode?: boolean;
  forgeGroups?: ForgeGroups;
  /** Override the co-hosted HTTP recall endpoint. Defaults to env or config. */
  httpEndpoint?: string | null;
}

export interface RecallResult {
  tool: string;
  text: string;
  raw: McpToolResult;
  hits?: Array<Record<string, unknown>>;
  /** Transport used - 'http' is the fast local path, 'stdio' is the MCP fallback. */
  transport: 'http' | 'stdio';
}

const DEFAULT_HTTP_ENDPOINT = 'http://127.0.0.1:17317';
// Ollama cold-start + embed of the query can exceed 2s on the first call.
// 6s covers a cold local host without starving the stdio fallback on a real
// outage (we still fall through after the timeout).
const HTTP_TIMEOUT_MS = 6_000;
// Rerank calls can legitimately run much longer on the first request - the
// cross-encoder model warms up in-process and may trigger a download if the
// bootstrap warmup step was skipped. 90s gives headroom without leaving the
// user staring forever if something is genuinely wrong.
const HTTP_TIMEOUT_MS_RERANK = 90_000;

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

async function httpPost(
  endpoint: string,
  path: string,
  body: unknown,
  opts: { rerank?: boolean } = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutMs = opts.rerank ? HTTP_TIMEOUT_MS_RERANK : HTTP_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await recallAuthHeaders()) },
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

function confidenceNote(confidence: unknown): string {
  if (confidence !== 'low') return '';
  return '\nlow confidence: nothing in this vault scored like a real match for that query.';
}

function formatHits(hits: Array<Record<string, unknown>>): string {
  return hits.map((h) => JSON.stringify(h, null, 2)).join('\n');
}

const COMPACT_SNIPPET_CHARS = 240;

function lastHeadingSegment(heading: unknown): string {
  if (typeof heading !== 'string' || heading.length === 0) return '';
  const parts = heading.split(' / ');
  return (parts[parts.length - 1] ?? '').trim();
}

function snippet(text: unknown, max = COMPACT_SNIPPET_CHARS): string {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.trimEnd()}…`;
}

function formatHitsCompact(hits: Array<Record<string, unknown>>, snippetMax?: number): string {
  const max = snippetMax ?? COMPACT_SNIPPET_CHARS;
  return hits
    .map((h, i) => {
      const score = typeof h.score === 'number' ? h.score.toFixed(3) : '-';
      const file = typeof h.file === 'string' ? h.file : '(unknown)';
      const head = lastHeadingSegment(h.heading);
      const headPart = head ? ` › ${head}` : '';
      const superseded =
        typeof h.superseded_by === 'string' && h.superseded_by
          ? ` → superseded by [[${h.superseded_by}]]`
          : '';
      const neighbors = neighborLines(h, Math.floor(max / 2));
      return `${i + 1}. [${score}] ${file}${headPart}${superseded}\n   ${snippet(h.text, max)}${neighbors}${codeRefWarnings(h)}`;
    })
    .join('\n');
}

function neighborLines(h: Record<string, unknown>, max: number): string {
  const nt = h.neighbor_text;
  if (typeof nt !== 'object' || nt === null) return '';
  const parts: string[] = [];
  for (const key of ['prev', 'next'] as const) {
    const text = (nt as Record<string, unknown>)[key];
    if (typeof text === 'string' && text) parts.push(`\n   ↳ ${key}: ${snippet(text, max)}`);
  }
  return parts.join('');
}

function formatHitsFiles(hits: Array<Record<string, unknown>>): string {
  return hits
    .map((h, i) => {
      const score = typeof h.score === 'number' ? h.score.toFixed(3) : '-';
      const file = typeof h.file === 'string' ? h.file : '(unknown)';
      const title =
        typeof h.note_title === 'string' && h.note_title
          ? h.note_title
          : firstHeadingSegment(h.heading);
      const superseded =
        typeof h.superseded_by === 'string' && h.superseded_by
          ? ` → superseded by [[${h.superseded_by}]]`
          : '';
      return `${i + 1}. [${score}] ${file}${title ? ` - ${title}` : ''}${superseded}`;
    })
    .join('\n');
}

function firstHeadingSegment(heading: unknown): string {
  if (typeof heading !== 'string' || heading.length === 0) return '';
  const first = (heading.split(' / ')[0] ?? '').trim();
  return first === '(root)' ? '' : first;
}

const BUDGET_SNIPPET_LADDER = [COMPACT_SNIPPET_CHARS, 200, 160, 120, 80];

function formatHitsBudget(hits: Array<Record<string, unknown>>, budgetTokens: number): string {
  const budgetChars = Math.max(1, budgetTokens) * 4;
  const pool = [...hits];
  let best = '';
  while (pool.length > 0) {
    for (const cap of BUDGET_SNIPPET_LADDER) {
      const rendered = formatHitsCompact(pool, cap);
      if (rendered.length <= budgetChars) return rendered;
      best = rendered;
    }
    pool.pop();
  }
  return best;
}

async function annotateTitles(
  hits: Array<Record<string, unknown>>,
  vaultPath: string,
): Promise<void> {
  const { resolveNotePath } = await import('../scribe/scribe.js');
  const { frontmatterString, readNoteFrontmatter } = await import('../scribe/frontmatter.js');
  for (const h of hits) {
    if (typeof h.file !== 'string') continue;
    try {
      const fm = await readNoteFrontmatter(resolveNotePath(h.file, vaultPath));
      const title = frontmatterString(fm, 'title');
      if (title) h.note_title = title;
    } catch {
      continue;
    }
  }
}

async function annotateCodeRefs(
  hits: Array<Record<string, unknown>>,
  vaultPath: string,
  groups: ForgeGroups,
): Promise<void> {
  const { resolveNotePath } = await import('../scribe/scribe.js');
  const { frontmatterList, readNoteFrontmatter } = await import('../scribe/frontmatter.js');
  const deadline = Date.now() + 10_000;
  for (const h of hits) {
    if (typeof h.file !== 'string') continue;
    let refs: string[];
    try {
      refs = frontmatterList(await readNoteFrontmatter(resolveNotePath(h.file, vaultPath)), 'code');
    } catch {
      continue;
    }
    if (refs.length === 0) continue;
    h.code_refs = await verifyCodeRefs(refs, groups, { deadline });
  }
}

function codeRefWarnings(h: Record<string, unknown>): string {
  if (!Array.isArray(h.code_refs)) return '';
  return (h.code_refs as CodeRefResult[])
    .filter((r) => r.status !== 'ok')
    .map((r) => `\n   ⚠ code ref ${r.status}: ${r.ref}`)
    .join('');
}

async function httpRecall(opts: RecallOptions): Promise<RecallResult | null> {
  const endpoint = resolveEndpoint(opts.httpEndpoint);
  const fmt = (hits: Array<Record<string, unknown>>): string => {
    if (opts.files) return formatHitsFiles(hits);
    if (opts.budgetTokens !== undefined) return formatHitsBudget(hits, opts.budgetTokens);
    if (opts.compact) return formatHitsCompact(hits);
    return formatHits(hits);
  };
  const annotate = async (hits: Array<Record<string, unknown>>): Promise<void> => {
    if (opts.files) await annotateTitles(hits, opts.vaultPath);
    if (opts.verifyCode) await annotateCodeRefs(hits, opts.vaultPath, opts.forgeGroups ?? {});
  };
  try {
    if (opts.tier === 'expand') {
      const body = (await httpPost(endpoint, '/expand', {
        query: opts.query,
        k: opts.k ?? 5,
      })) as {
        hits: Array<Record<string, unknown>>;
        expansions: unknown[];
      };
      await annotate(body.hits);
      const expandTail = opts.compact
        ? `\n+${body.expansions.length} linked (use --json for full)`
        : `\n---expansions---\n${JSON.stringify(body.expansions, null, 2)}`;
      const text = `${fmt(body.hits)}${expandTail}`;
      return {
        tool: 'http:expand',
        text,
        raw: rawFromText(text),
        hits: body.hits,
        transport: 'http',
      };
    }

    const hits = (await httpPost(
      endpoint,
      '/search',
      {
        query: opts.query,
        k: opts.k ?? 5,
        rerank: opts.rerank ?? false,
        mode: opts.mode ?? 'hybrid',
        neighbors: opts.neighbors ?? false,
      },
      { rerank: opts.rerank },
    )) as { hits: Array<Record<string, unknown>>; confidence?: string };
    await annotate(hits.hits);
    const note = confidenceNote(hits.confidence);
    if (opts.tier === 'fast') {
      const text = `${fmt(hits.hits)}${note}`;
      return {
        tool: 'http:search',
        text,
        raw: rawFromText(text),
        hits: hits.hits,
        transport: 'http',
      };
    }

    // deep tier: search then related_notes on the top hit
    const topFile = (hits.hits[0]?.file as string | undefined) ?? null;
    if (!topFile) {
      const text = `${fmt(hits.hits)}${note}`;
      return {
        tool: 'http:search',
        text,
        raw: rawFromText(text),
        hits: hits.hits,
        transport: 'http',
      };
    }
    const related = await httpPost(endpoint, '/related', { file: topFile });
    const relatedTail = opts.compact
      ? `\n+related to ${topFile} (use --deep --json for full)`
      : `\n---related to ${topFile}---\n${JSON.stringify(related, null, 2)}`;
    const text = `${fmt(hits.hits)}${relatedTail}${note}`;
    return {
      tool: 'http:search+related',
      text,
      raw: rawFromText(text),
      hits: hits.hits,
      transport: 'http',
    };
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
  if (opts.verifyCode) {
    process.stderr.write(
      'recall: --verify-code skipped - fell back to the stdio transport, where code refs are not validated\n',
    );
  }
  return stdioRecall(opts);
}

export function extractFirstFile(rendered: string): string | null {
  const match = rendered.match(/^([^\s:]+\.md):/m) ?? rendered.match(/^###?\s+([^\s]+\.md)/m);
  return match?.[1] ?? null;
}
