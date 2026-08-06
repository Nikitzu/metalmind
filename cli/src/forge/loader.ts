import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { shelfSpecMtime } from './openapi.js';
import { buildRouteMatchEdges, extractRoutes, type RouteEntry } from './routes.js';
import { FORGE_CACHE_DIR, type ForgeGroup } from './store.js';
import { extractSymbols, type SymbolEntry } from './symbols.js';

export interface GraphNode {
  id: string;
  label?: string;
  type?: string;
  repo?: string;
  [key: string]: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
  type?: string;
  confidence?: string;
  repo?: string;
  [key: string]: unknown;
}

export interface MergedForgeGraph {
  generatedAt: string;
  repos: string[];
  nodeCount: number;
  edgeCount: number;
  nameMatchEdgeCount: number;
  routeMatchEdgeCount: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const FINGERPRINT_SOURCES = [
  ['.git', 'HEAD'],
  ['.git', 'index'],
  ['package.json'],
  ['pyproject.toml'],
  ['pom.xml'],
];

async function repoFingerprint(repo: string): Promise<number> {
  let max = 0;
  for (const parts of FINGERPRINT_SOURCES) {
    const path = join(repo, ...parts);
    if (!existsSync(path)) continue;
    try {
      const info = await stat(path);
      if (info.mtimeMs > max) max = info.mtimeMs;
    } catch {}
  }
  if (max === 0 && existsSync(repo)) {
    try {
      const info = await stat(repo);
      if (info.mtimeMs > max) max = info.mtimeMs;
    } catch {
      max = 0;
    }
  }
  const specMtime = await shelfSpecMtime(repo);
  if (specMtime > max) max = specMtime;
  return max;
}

async function latestRepoMtime(repos: string[]): Promise<number> {
  let max = 0;
  for (const repo of repos) {
    const fp = await repoFingerprint(repo);
    if (fp > max) max = fp;
  }
  return max;
}

export function symbolNode(sym: SymbolEntry): GraphNode {
  return {
    id: `${sym.repo}::${sym.file}::${sym.name}`,
    label: sym.name,
    type: sym.kind,
    repo: sym.repo,
    file: sym.file,
    line: sym.line,
  };
}

const MAX_NAME_GROUP = 40;

export function buildNameMatchEdges(nodes: GraphNode[]): GraphEdge[] {
  const byLabel = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const label = node.label ?? node.id.split('::').pop() ?? node.id;
    if (!label) continue;
    const bucket = byLabel.get(label) ?? [];
    bucket.push(node);
    byLabel.set(label, bucket);
  }

  const edges: GraphEdge[] = [];
  for (const [label, group] of byLabel) {
    if (group.length < 2) continue;
    const distinctRepos = new Set(group.map((n) => n.repo));
    if (distinctRepos.size < 2) continue;
    if (group.length > MAX_NAME_GROUP) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (!a || !b || a.repo === b.repo) continue;
        edges.push({
          source: a.id,
          target: b.id,
          type: 'semantically_similar_to',
          confidence: 'INFERRED_NAME',
          label,
        });
      }
    }
  }
  return edges;
}

function routeCachePath(cacheDir: string, repo: string, includeLiterals: boolean): string {
  const key = includeLiterals ? `${repo}\0literals` : repo;
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16);
  return join(cacheDir, 'routes', `${hash}.json`);
}

function symbolCachePath(cacheDir: string, repo: string): string {
  const hash = createHash('sha1').update(repo).digest('hex').slice(0, 16);
  return join(cacheDir, 'symbols', `${hash}.json`);
}

interface CachedRoutes {
  repo: string;
  mtime: number;
  routes: RouteEntry[];
}

interface CachedSymbols {
  repo: string;
  mtime: number;
  symbols: SymbolEntry[];
}

async function extractSymbolsCached(repo: string, cacheDir: string): Promise<SymbolEntry[]> {
  const cachePath = symbolCachePath(cacheDir, repo);
  const fingerprint = await repoFingerprint(repo);

  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as CachedSymbols;
      if (cached.repo === repo && fingerprint > 0 && cached.mtime >= fingerprint) {
        return cached.symbols;
      }
    } catch {
      await rm(cachePath, { force: true });
    }
  }

  const fresh = await extractSymbols(repo);
  if (fingerprint > 0) {
    await mkdir(join(cacheDir, 'symbols'), { recursive: true });
    const payload: CachedSymbols = { repo, mtime: fingerprint, symbols: fresh };
    await writeFile(cachePath, JSON.stringify(payload), 'utf8');
  }
  return fresh;
}

async function extractRoutesCached(
  repo: string,
  cacheDir: string,
  includeLiterals: boolean,
): Promise<RouteEntry[]> {
  const cachePath = routeCachePath(cacheDir, repo, includeLiterals);
  const fingerprint = await repoFingerprint(repo);

  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as CachedRoutes;
      if (cached.repo === repo && fingerprint > 0 && cached.mtime >= fingerprint) {
        return cached.routes;
      }
    } catch {
      // corrupt cache - fall through and rewalk
    }
  }

  const fresh = await extractRoutes(repo, { includeLiterals });
  if (fingerprint > 0) {
    await mkdir(join(cacheDir, 'routes'), { recursive: true });
    const payload: CachedRoutes = { repo, mtime: fingerprint, routes: fresh };
    await writeFile(cachePath, JSON.stringify(payload), 'utf8');
  }
  return fresh;
}

/** Delete cached route files whose recorded repo path no longer exists on
 *  disk. Keeps the cache from accumulating orphans (typical cause: tmp dirs
 *  from tests that macOS sweeps). Best-effort - never throws. */
async function pruneOrphanDir(dir: string): Promise<number> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return 0;
  }
  let pruned = 0;
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const abs = join(dir, name);
    try {
      const raw = await readFile(abs, 'utf8');
      const { repo } = JSON.parse(raw) as { repo?: string };
      if (!repo || !existsSync(repo)) {
        await unlink(abs);
        pruned++;
      }
    } catch {
      // corrupt or unreadable - drop it
      try {
        await unlink(abs);
        pruned++;
      } catch {
        // ignore
      }
    }
  }
  return pruned;
}

export async function pruneOrphanRouteCaches(cacheDir: string): Promise<number> {
  const routes = await pruneOrphanDir(join(cacheDir, 'routes'));
  const symbols = await pruneOrphanDir(join(cacheDir, 'symbols'));
  return routes + symbols;
}

export async function buildMergedGraph(
  group: ForgeGroup,
  opts: { cacheDir?: string; includeLiterals?: boolean } = {},
): Promise<MergedForgeGraph> {
  const cacheDir = opts.cacheDir ?? FORGE_CACHE_DIR;
  const includeLiterals = opts.includeLiterals ?? false;
  await pruneOrphanRouteCaches(cacheDir);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const repo of group.repos) {
    for (const sym of await extractSymbolsCached(repo, cacheDir)) {
      nodes.push(symbolNode(sym));
    }
  }

  const nameMatchEdges = buildNameMatchEdges(nodes);
  edges.push(...nameMatchEdges);

  const allRoutes: RouteEntry[] = [];
  for (const repo of group.repos) {
    allRoutes.push(...(await extractRoutesCached(repo, cacheDir, includeLiterals)));
  }
  const routeEdges = buildRouteMatchEdges(allRoutes);
  for (const r of routeEdges) edges.push({ ...r });

  return {
    generatedAt: new Date().toISOString(),
    repos: [...group.repos],
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nameMatchEdgeCount: nameMatchEdges.length,
    routeMatchEdgeCount: routeEdges.length,
    nodes,
    edges,
  };
}

export async function loadOrBuildMerged(
  name: string,
  group: ForgeGroup,
  opts: { forceRebuild?: boolean; cacheDir?: string; includeLiterals?: boolean } = {},
): Promise<MergedForgeGraph> {
  const dir = opts.cacheDir ?? FORGE_CACHE_DIR;
  // Prune orphans on every call - buildMergedGraph is skipped on the warm
  // path when the merged cache is fresh, so a prune there would never run
  // for long-lived forges.
  await pruneOrphanRouteCaches(dir);
  const suffix = opts.includeLiterals ? '.literals.json' : '.json';
  const path = join(dir, `${name}${suffix}`);
  if (!opts.forceRebuild && existsSync(path)) {
    const cached = JSON.parse(await readFile(path, 'utf8')) as MergedForgeGraph;
    const cachedTime = Date.parse(cached.generatedAt);
    const latest = await latestRepoMtime(group.repos);
    if (!Number.isNaN(cachedTime) && latest > 0 && cachedTime >= latest) {
      return cached;
    }
  }
  const merged = await buildMergedGraph(group, {
    cacheDir: dir,
    includeLiterals: opts.includeLiterals,
  });
  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

// Re-export for tests
export function defaultCacheDir(): string {
  return join(homedir(), '.metalmind', 'forge');
}

export interface CrossRepoHighlight {
  source: string;
  target: string;
  confidence: 'INFERRED_NAME' | 'INFERRED_ROUTE';
  label: string;
  method?: string;
  path?: string;
}

/** Pull every INFERRED_NAME / INFERRED_ROUTE edge in a merged graph whose
 *  source, target, label or route matches the user's query (case-insensitive
 *  substring). Answers "given this concept/symbol, where does it surface in
 *  OTHER repos?" - the whole point of a forge. */
export function crossRepoHighlights(merged: MergedForgeGraph, query: string): CrossRepoHighlight[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const nodesById = new Map(merged.nodes.map((n) => [n.id, n]));
  const out: CrossRepoHighlight[] = [];
  for (const e of merged.edges) {
    if (e.confidence !== 'INFERRED_NAME' && e.confidence !== 'INFERRED_ROUTE') continue;
    const src = nodesById.get(e.source);
    const tgt = nodesById.get(e.target);
    const haystack = [
      src?.label ?? e.source,
      tgt?.label ?? e.target,
      String((e as Record<string, unknown>).label ?? ''),
      String((e as Record<string, unknown>).path ?? ''),
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) continue;
    out.push({
      source: e.source,
      target: e.target,
      confidence: e.confidence as 'INFERRED_NAME' | 'INFERRED_ROUTE',
      label: String((e as Record<string, unknown>).label ?? ''),
      method: (e as Record<string, unknown>).method as string | undefined,
      path: (e as Record<string, unknown>).path as string | undefined,
    });
  }
  return out;
}

export function formatCrossRepoHighlight(h: CrossRepoHighlight): string {
  if (h.confidence === 'INFERRED_ROUTE') {
    return `  ${h.source}  -[${h.method ?? 'ANY'} ${h.path ?? ''}]→  ${h.target}`;
  }
  return `  ${h.source}  -[name: ${h.label}]→  ${h.target}`;
}
