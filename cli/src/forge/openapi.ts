import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { HttpMethod, RouteEntry } from './routes.js';

const SHELF_EXTS = ['yaml', 'yml', 'json'] as const;

const HTTP_METHODS: ReadonlyArray<HttpMethod> = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
];

export function shelfDir(): string {
  return process.env.METALMIND_SHELF_DIR ?? join(homedir(), '.metalmind', 'specs');
}

export function shelfPathFor(repo: string, ext: (typeof SHELF_EXTS)[number]): string {
  return join(shelfDir(), `${basename(repo)}.${ext}`);
}

async function findShelfSpec(repo: string): Promise<string | null> {
  for (const ext of SHELF_EXTS) {
    const abs = shelfPathFor(repo, ext);
    try {
      const s = await stat(abs);
      if (s.isFile()) return abs;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Returns the shelf OpenAPI spec's mtime for this repo, or 0 if there is no
 *  spec on the shelf. Used by the route-cache + merged-graph staleness
 *  fingerprint — without this, editing a spec on the shelf would not bust the
 *  cache, and callers would silently read stale route edges. */
export async function shelfSpecMtime(repo: string): Promise<number> {
  const abs = await findShelfSpec(repo);
  if (!abs) return 0;
  try {
    return (await stat(abs)).mtimeMs;
  } catch {
    return 0;
  }
}

function parseSpec(raw: string, file: string): unknown {
  if (file.endsWith('.json')) return JSON.parse(raw);
  return parseYaml(raw);
}

/** Derive a basePath from `servers[].url`. Picks the shortest URL-path across
 *  servers so we don't prepend a prod-only prefix when dev/local servers are
 *  bare. Returns '' when no servers or none carry a path. */
export function deriveBasePath(servers: unknown): string {
  if (!Array.isArray(servers)) return '';
  const paths: string[] = [];
  for (const s of servers) {
    if (!s || typeof s !== 'object') continue;
    const url = (s as { url?: unknown }).url;
    if (typeof url !== 'string') continue;
    let path = '';
    try {
      path = new URL(url).pathname;
    } catch {
      path = url.startsWith('/') ? url : '';
    }
    if (path === '/') path = '';
    if (path.endsWith('/')) path = path.slice(0, -1);
    paths.push(path);
  }
  if (paths.length === 0) return '';
  paths.sort((a, b) => a.length - b.length);
  return paths[0] ?? '';
}

export function parseOpenApiDoc(doc: unknown, file: string, repo: string): RouteEntry[] {
  if (!doc || typeof doc !== 'object') return [];
  const d = doc as Record<string, unknown>;
  const paths = d.paths;
  if (!paths || typeof paths !== 'object') return [];
  const basePath = deriveBasePath(d.servers);
  const out: RouteEntry[] = [];
  for (const [rawPath, item] of Object.entries(paths as Record<string, unknown>)) {
    if (!item || typeof item !== 'object') continue;
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const fullPath = `${basePath}${path}` || path;
    for (const method of HTTP_METHODS) {
      const key = method.toLowerCase();
      if (key in (item as Record<string, unknown>)) {
        out.push({
          method,
          path: fullPath,
          kind: 'handler',
          framework: 'openapi',
          file,
          repo,
        });
      }
    }
  }
  return out;
}

/** Read the OpenAPI spec for `repo` from metalmind's spec shelf at
 *  `~/.metalmind/specs/<repo-basename>.{yaml,yml,json}`. We deliberately do
 *  NOT read specs from inside the target repo — single-dev tool, zero repo
 *  pollution. Use `metalmind forge capture-spec` to populate the shelf. */
export async function extractOpenApiRoutes(repo: string): Promise<RouteEntry[]> {
  const spec = await findShelfSpec(repo);
  if (!spec) return [];
  let raw: string;
  try {
    raw = await readFile(spec, 'utf8');
  } catch {
    return [];
  }
  let doc: unknown;
  try {
    doc = parseSpec(raw, spec);
  } catch {
    return [];
  }
  return parseOpenApiDoc(doc, spec, repo);
}
