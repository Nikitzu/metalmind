import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildRouteMatchEdges, extractRoutes, type RouteEntry } from './routes.js';
import { FORGE_CACHE_DIR, type ForgeGroup } from './store.js';

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

export interface GraphDocument {
  nodes: GraphNode[];
  edges?: GraphEdge[];
  links?: GraphEdge[];
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

function repoGraphPath(repo: string): string {
  return join(repo, 'graphify-out', 'graph.json');
}

async function loadGraph(repo: string): Promise<GraphDocument | null> {
  const path = repoGraphPath(repo);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as GraphDocument;
}

async function latestRepoMtime(repos: string[]): Promise<number> {
  let max = 0;
  for (const repo of repos) {
    const path = repoGraphPath(repo);
    if (existsSync(path)) {
      const info = await stat(path);
      if (info.mtimeMs > max) max = info.mtimeMs;
    }
  }
  return max;
}

function qualifyNode(node: GraphNode, repo: string): GraphNode {
  return { ...node, id: `${repo}::${node.id}`, repo };
}

function qualifyEdge(edge: GraphEdge, repo: string): GraphEdge {
  return {
    ...edge,
    source: `${repo}::${edge.source}`,
    target: `${repo}::${edge.target}`,
    repo,
  };
}

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

function routeCachePath(cacheDir: string, repo: string): string {
  const hash = createHash('sha1').update(repo).digest('hex').slice(0, 16);
  return join(cacheDir, 'routes', `${hash}.json`);
}

interface CachedRoutes {
  repo: string;
  mtime: number;
  routes: RouteEntry[];
}

async function extractRoutesCached(repo: string, cacheDir: string): Promise<RouteEntry[]> {
  const cachePath = routeCachePath(cacheDir, repo);
  const graphPath = repoGraphPath(repo);
  // Use the repo's graph.json mtime as a proxy for "code changed since last walk".
  // graphify rewrites graph.json on every `graphify update`, so the cache is valid
  // until the next code-graph regeneration.
  let graphMtime = 0;
  if (existsSync(graphPath)) {
    const info = await stat(graphPath);
    graphMtime = info.mtimeMs;
  }

  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as CachedRoutes;
      if (cached.repo === repo && graphMtime > 0 && cached.mtime >= graphMtime) {
        return cached.routes;
      }
    } catch {
      // corrupt cache — fall through and rewalk
    }
  }

  const fresh = await extractRoutes(repo);
  if (graphMtime > 0) {
    await mkdir(join(cacheDir, 'routes'), { recursive: true });
    const payload: CachedRoutes = { repo, mtime: graphMtime, routes: fresh };
    await writeFile(cachePath, JSON.stringify(payload), 'utf8');
  }
  return fresh;
}

/** Delete cached route files whose recorded repo path no longer exists on
 *  disk. Keeps the cache from accumulating orphans (typical cause: tmp dirs
 *  from tests that macOS sweeps). Best-effort — never throws. */
export async function pruneOrphanRouteCaches(cacheDir: string): Promise<number> {
  const routesDir = join(cacheDir, 'routes');
  let files: string[];
  try {
    files = await readdir(routesDir);
  } catch {
    return 0;
  }
  let pruned = 0;
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const abs = join(routesDir, name);
    try {
      const raw = await readFile(abs, 'utf8');
      const { repo } = JSON.parse(raw) as { repo?: string };
      if (!repo || !existsSync(repo)) {
        await unlink(abs);
        pruned++;
      }
    } catch {
      // corrupt or unreadable — drop it
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

export async function buildMergedGraph(
  group: ForgeGroup,
  opts: { cacheDir?: string } = {},
): Promise<MergedForgeGraph> {
  const cacheDir = opts.cacheDir ?? FORGE_CACHE_DIR;
  await pruneOrphanRouteCaches(cacheDir);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const repo of group.repos) {
    const graph = await loadGraph(repo);
    if (!graph) continue;
    for (const node of graph.nodes ?? []) {
      nodes.push(qualifyNode(node, repo));
    }
    const repoEdges = graph.edges ?? graph.links ?? [];
    for (const edge of repoEdges) {
      edges.push(qualifyEdge(edge, repo));
    }
  }

  const nameMatchEdges = buildNameMatchEdges(nodes);
  edges.push(...nameMatchEdges);

  const allRoutes: RouteEntry[] = [];
  for (const repo of group.repos) {
    allRoutes.push(...(await extractRoutesCached(repo, cacheDir)));
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
  opts: { forceRebuild?: boolean; cacheDir?: string } = {},
): Promise<MergedForgeGraph> {
  const dir = opts.cacheDir ?? FORGE_CACHE_DIR;
  const path = join(dir, `${name}.json`);
  if (!opts.forceRebuild && existsSync(path)) {
    const cached = JSON.parse(await readFile(path, 'utf8')) as MergedForgeGraph;
    const cachedTime = Date.parse(cached.generatedAt);
    const latest = await latestRepoMtime(group.repos);
    if (!Number.isNaN(cachedTime) && latest > 0 && cachedTime >= latest) {
      return cached;
    }
  }
  const merged = await buildMergedGraph(group, { cacheDir: dir });
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
 *  OTHER repos?" — the whole point of a forge. */
export function crossRepoHighlights(
  merged: MergedForgeGraph,
  query: string,
): CrossRepoHighlight[] {
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
    return `  ${h.source}  —[${h.method ?? 'ANY'} ${h.path ?? ''}]→  ${h.target}`;
  }
  return `  ${h.source}  —[name: ${h.label}]→  ${h.target}`;
}
