import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractOpenApiRoutes } from './openapi.js';

export type RouteKind = 'handler' | 'caller';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ANY';

export interface RouteEntry {
  method: HttpMethod;
  path: string;
  kind: RouteKind;
  framework: string;
  file: string;
  repo: string;
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.mypy_cache',
  '.pytest_cache',
  'coverage',
  'graphify-out',
  '.metalmind-stack',
]);

const JS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const PY_EXT = new Set(['.py']);

async function* walk(root: string, exts: Set<string>): AsyncGenerator<string> {
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop();
    if (!dir) continue;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push(join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const dotIdx = entry.name.lastIndexOf('.');
        if (dotIdx < 0) continue;
        const ext = entry.name.slice(dotIdx);
        if (exts.has(ext)) yield join(dir, entry.name);
      }
    }
  }
}

const JS_HANDLER_RE =
  /\b(?:app|router|fastify|server)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
// Captures url (group 1) and optional explicit method (group 2) from the
// second-arg init object. Falls back to 'GET' (fetch's default) — not 'ANY' —
// so the method-equality guard in buildRouteMatchEdges stays meaningful.
const JS_FETCH_RE =
  /\bfetch\s*\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*\{[^}]*?\bmethod\s*:\s*['"]([^'"]+)['"][^}]*\})?/g;
const JS_AXIOS_RE =
  /\b(?:axios|got)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
const PY_FASTAPI_RE =
  /@(?:\w+)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"]([^'"]+)['"]/gi;
const PY_FLASK_RE = /@(?:\w+)\.route\s*\(\s*['"]([^'"]+)['"](?:[^)]*methods\s*=\s*\[([^\]]+)\])?/gi;
const PY_REQUESTS_RE =
  /\b(?:httpx|requests)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"]([^'"]+)['"]/gi;

function normPath(raw: string): string {
  if (!raw.startsWith('/')) return `/${raw}`;
  return raw;
}

/** Canonicalize a route path for cross-repo bucketing. Maps every param
 *  notation to a shared `:param` marker so Express (`:id`), FastAPI (`{id}`),
 *  Flask (`<int:id>`), and JS template literals (`${id}`) all collide on the
 *  same key. Also strips query strings and trailing slashes (except root). */
export function canonicalizePath(raw: string): string {
  let p = raw.startsWith('/') ? raw : `/${raw}`;
  const qIdx = p.indexOf('?');
  if (qIdx >= 0) p = p.slice(0, qIdx);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  const parts = p.split('/').map((seg) => {
    if (!seg) return seg;
    if (seg.startsWith(':')) return ':param';
    if (/^\{[^}]+\}$/.test(seg)) return ':param';
    if (/^<[^>]+>$/.test(seg)) return ':param';
    if (/\$\{[^}]*\}/.test(seg)) return ':param';
    return seg;
  });
  return parts.join('/');
}

export function parseJs(
  content: string,
  file: string,
  repo: string,
  framework = 'js',
): RouteEntry[] {
  const out: RouteEntry[] = [];
  for (const match of content.matchAll(JS_HANDLER_RE)) {
    out.push({
      method: match[1]?.toUpperCase() as HttpMethod,
      path: normPath(match[2] ?? ''),
      kind: 'handler',
      framework,
      file,
      repo,
    });
  }
  for (const match of content.matchAll(JS_FETCH_RE)) {
    const raw = match[1] ?? '';
    if (!raw.startsWith('/') && !raw.startsWith('http')) continue;
    if (raw.startsWith('http')) continue;
    const method = (match[2]?.toUpperCase() as HttpMethod | undefined) ?? 'GET';
    out.push({ method, path: normPath(raw), kind: 'caller', framework, file, repo });
  }
  for (const match of content.matchAll(JS_AXIOS_RE)) {
    const raw = match[2] ?? '';
    if (!raw.startsWith('/') && !raw.startsWith('http')) continue;
    if (raw.startsWith('http')) continue;
    out.push({
      method: match[1]?.toUpperCase() as HttpMethod,
      path: normPath(raw),
      kind: 'caller',
      framework,
      file,
      repo,
    });
  }
  return out;
}

export function parsePy(content: string, file: string, repo: string): RouteEntry[] {
  const out: RouteEntry[] = [];
  for (const match of content.matchAll(PY_FASTAPI_RE)) {
    out.push({
      method: match[1]?.toUpperCase() as HttpMethod,
      path: normPath(match[2] ?? ''),
      kind: 'handler',
      framework: 'fastapi',
      file,
      repo,
    });
  }
  for (const match of content.matchAll(PY_FLASK_RE)) {
    const path = normPath(match[1] ?? '');
    const methodsRaw = match[2];
    const methods = methodsRaw
      ? methodsRaw.split(',').map((m) => m.trim().replace(/['"]/g, '').toUpperCase() as HttpMethod)
      : (['GET'] as HttpMethod[]);
    for (const method of methods) {
      out.push({ method, path, kind: 'handler', framework: 'flask', file, repo });
    }
  }
  for (const match of content.matchAll(PY_REQUESTS_RE)) {
    const raw = match[2] ?? '';
    if (!raw.startsWith('/')) continue;
    out.push({
      method: match[1]?.toUpperCase() as HttpMethod,
      path: normPath(raw),
      kind: 'caller',
      framework: 'python',
      file,
      repo,
    });
  }
  return out;
}

export async function extractRoutes(repo: string): Promise<RouteEntry[]> {
  const out: RouteEntry[] = [];
  out.push(...(await extractOpenApiRoutes(repo)));
  for await (const file of walk(repo, JS_EXT)) {
    const content = await readFile(file, 'utf8');
    out.push(...parseJs(content, file, repo));
  }
  for await (const file of walk(repo, PY_EXT)) {
    const content = await readFile(file, 'utf8');
    out.push(...parsePy(content, file, repo));
  }
  return out;
}

export interface RouteEdge {
  source: string;
  target: string;
  type: 'calls_route';
  confidence: 'INFERRED_ROUTE';
  method: HttpMethod;
  path: string;
}

export function buildRouteMatchEdges(routes: RouteEntry[]): RouteEdge[] {
  const byKey = new Map<string, RouteEntry[]>();
  for (const r of routes) {
    const key = canonicalizePath(r.path);
    const bucket = byKey.get(key) ?? [];
    bucket.push(r);
    byKey.set(key, bucket);
  }

  const edges: RouteEdge[] = [];
  for (const group of byKey.values()) {
    const callers = group.filter((r) => r.kind === 'caller');
    const handlers = group.filter((r) => r.kind === 'handler');
    for (const caller of callers) {
      for (const handler of handlers) {
        if (caller.repo === handler.repo) continue;
        if (caller.method !== 'ANY' && caller.method !== handler.method) continue;
        edges.push({
          source: `${caller.repo}::${caller.file}`,
          target: `${handler.repo}::${handler.file}`,
          type: 'calls_route',
          confidence: 'INFERRED_ROUTE',
          method: handler.method,
          path: handler.path,
        });
      }
    }
  }
  return edges;
}
