import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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

export async function buildMergedGraph(
  group: ForgeGroup,
  opts: { cacheDir?: string } = {},
): Promise<MergedForgeGraph> {
  const cacheDir = opts.cacheDir ?? FORGE_CACHE_DIR;
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
