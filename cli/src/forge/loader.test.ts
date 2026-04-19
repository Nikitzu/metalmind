import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMergedGraph, buildNameMatchEdges, loadOrBuildMerged } from './loader.js';
import type { ForgeGroup } from './store.js';

async function writeGraph(
  repo: string,
  nodes: Array<{ id: string; label?: string }>,
  edges: Array<{ source: string; target: string; type?: string }> = [],
): Promise<void> {
  const dir = join(repo, 'graphify-out');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'graph.json'), JSON.stringify({ nodes, edges }), 'utf8');
}

describe('forge loader', () => {
  let tmp: string;
  let cacheDir: string;
  let repoA: string;
  let repoB: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-loader-'));
    cacheDir = join(tmp, 'cache');
    repoA = join(tmp, 'repo-a');
    repoB = join(tmp, 'repo-b');
    await mkdir(repoA, { recursive: true });
    await mkdir(repoB, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('buildNameMatchEdges emits pairwise cross-repo edges for shared labels', () => {
    const nodes = [
      { id: 'a::fn1', label: 'sendNotification', repo: '/a' },
      { id: 'b::fn9', label: 'sendNotification', repo: '/b' },
      { id: 'b::fn2', label: 'unrelated', repo: '/b' },
    ];
    const edges = buildNameMatchEdges(nodes);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: 'a::fn1',
      target: 'b::fn9',
      type: 'semantically_similar_to',
      confidence: 'INFERRED_NAME',
      label: 'sendNotification',
    });
  });

  it('skips name-match when all matching nodes live in the same repo', () => {
    const nodes = [
      { id: 'a::a', label: 'x', repo: '/a' },
      { id: 'a::b', label: 'x', repo: '/a' },
    ];
    expect(buildNameMatchEdges(nodes)).toHaveLength(0);
  });

  it('buildMergedGraph qualifies ids and unions repos', async () => {
    await writeGraph(repoA, [{ id: 'fn', label: 'auth' }]);
    await writeGraph(repoB, [{ id: 'fn', label: 'auth' }]);

    const group: ForgeGroup = { repos: [repoA, repoB] };
    const merged = await buildMergedGraph(group);

    expect(merged.nodeCount).toBe(2);
    expect(merged.nodes.map((n) => n.id).sort()).toEqual([`${repoA}::fn`, `${repoB}::fn`].sort());
    expect(merged.nameMatchEdgeCount).toBe(1);
    expect(merged.edges[0]?.confidence).toBe('INFERRED_NAME');
  });

  it('skips repos whose graph.json is missing', async () => {
    await writeGraph(repoA, [{ id: 'fn', label: 'auth' }]);
    const group: ForgeGroup = { repos: [repoA, repoB] };
    const merged = await buildMergedGraph(group);
    expect(merged.nodeCount).toBe(1);
  });

  it('loadOrBuildMerged writes cache and reads it back', async () => {
    await writeGraph(repoA, [{ id: 'fn', label: 'auth' }]);
    const group: ForgeGroup = { repos: [repoA] };

    const first = await loadOrBuildMerged('g', group, { cacheDir });
    const cacheFile = join(cacheDir, 'g.json');
    expect(existsSync(cacheFile)).toBe(true);

    const second = await loadOrBuildMerged('g', group, { cacheDir });
    expect(second.generatedAt).toBe(first.generatedAt);
  });

  it('loadOrBuildMerged rebuilds when repo graph is newer than cache', async () => {
    await writeGraph(repoA, [{ id: 'fn', label: 'auth' }]);
    const group: ForgeGroup = { repos: [repoA] };

    const first = await loadOrBuildMerged('g', group, { cacheDir });
    await new Promise((r) => setTimeout(r, 20));
    await writeGraph(repoA, [
      { id: 'fn', label: 'auth' },
      { id: 'fn2', label: 'logout' },
    ]);
    const second = await loadOrBuildMerged('g', group, { cacheDir });

    expect(second.nodeCount).toBe(2);
    expect(second.generatedAt).not.toBe(first.generatedAt);
  });
});
