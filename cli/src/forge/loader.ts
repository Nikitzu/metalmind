import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildRouteMatchEdges, extractRoutes } from './routes.js';
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

export async function buildMergedGraph(group: ForgeGroup): Promise<MergedForgeGraph> {
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

  const allRoutes = [];
  for (const repo of group.repos) {
    allRoutes.push(...(await extractRoutes(repo)));
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
  const merged = await buildMergedGraph(group);
  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

// Re-export for tests
export function defaultCacheDir(): string {
  return join(homedir(), '.metalmind', 'forge');
}
