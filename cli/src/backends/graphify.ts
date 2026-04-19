import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runCommand } from '../util/exec.js';

export const GRAPHIFY_OUT_DIR = 'graphify-out';
export const GRAPHIFY_GRAPH_FILE = 'graph.json';

export interface FindRepoRootOptions {
  startDir?: string;
}

export function findRepoRoot(opts: FindRepoRootOptions = {}): string | null {
  let dir = opts.startDir ?? process.cwd();
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function graphPath(repoRoot: string): string {
  return join(repoRoot, GRAPHIFY_OUT_DIR, GRAPHIFY_GRAPH_FILE);
}

export function hasGraph(repoRoot: string): boolean {
  return existsSync(graphPath(repoRoot));
}

export async function analyzeRepo(repoRoot: string): Promise<void> {
  const res = await runCommand('graphify', ['analyze', repoRoot], { timeoutMs: 600_000 });
  if (!res.ok) {
    throw new Error(`graphify analyze failed: ${res.stderr || res.stdout}`);
  }
}

export interface GraphifyQueryOptions {
  query: string;
  repoRoot: string;
}

export async function graphifyQuery(opts: GraphifyQueryOptions): Promise<string> {
  const res = await runCommand(
    'graphify',
    ['query', opts.query, '--graph', graphPath(opts.repoRoot)],
    { timeoutMs: 60_000 },
  );
  if (!res.ok) {
    throw new Error(`graphify query failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}
