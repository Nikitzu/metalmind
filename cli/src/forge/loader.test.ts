import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildMergedGraph,
  buildNameMatchEdges,
  loadOrBuildMerged,
  pruneOrphanRouteCaches,
} from './loader.js';
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

  it('caches per-repo routes by graph.json mtime; skips rewalk when unchanged', async () => {
    await writeGraph(repoA, [{ id: 'fn', label: 'x' }]);
    // Seed some source files so extractRoutes has something to find.
    await writeFile(
      join(repoA, 'handlers.ts'),
      "const r = router; r.get('/api/users', h);\n",
      'utf8',
    );
    const group: ForgeGroup = { repos: [repoA] };

    const first = await buildMergedGraph(group, { cacheDir });
    expect(first.routeMatchEdgeCount).toBe(0); // only one repo, no cross-repo routes

    // Simulate a source-only change (no graph.json update). Extract-cache keys
    // on graph.json mtime, so this write should NOT bust the route cache.
    await writeFile(
      join(repoA, 'handlers.ts'),
      "const r = router; r.get('/api/diff', h);\n",
      'utf8',
    );
    const second = await buildMergedGraph(group, { cacheDir });
    // Second call still reflects the cached routes (graph.json unchanged).
    expect(second.routeMatchEdgeCount).toBe(first.routeMatchEdgeCount);

    // Now bump graph.json — cache invalidates, fresh walk picks up new source.
    await new Promise((r) => setTimeout(r, 10));
    await writeGraph(repoA, [
      { id: 'fn', label: 'x' },
      { id: 'fn2', label: 'y' },
    ]);
    const third = await buildMergedGraph(group, { cacheDir });
    expect(third.nodeCount).toBe(2);
  });

  it('loadOrBuildMerged writes cache and reads it back', async () => {
    await writeGraph(repoA, [{ id: 'fn', label: 'auth' }]);
    const group: ForgeGroup = { repos: [repoA] };

    const first = await loadOrBuildMerged('g', group, { cacheDir });
    const cacheFile = join(cacheDir, 'g.json');
    expect(existsSync(cacheFile)).toBe(true);

    // Small wait so the second call's cache-age check can't race with repo mtime.
    await new Promise((r) => setTimeout(r, 10));
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

  it('pruneOrphanRouteCaches removes cache entries whose repo is gone', async () => {
    const routesDir = join(cacheDir, 'routes');
    await mkdir(routesDir, { recursive: true });
    const liveEntry = join(routesDir, 'live.json');
    const orphanEntry = join(routesDir, 'orphan.json');
    const corruptEntry = join(routesDir, 'corrupt.json');
    await writeFile(
      liveEntry,
      JSON.stringify({ repo: repoA, mtime: Date.now(), routes: [] }),
      'utf8',
    );
    await writeFile(
      orphanEntry,
      JSON.stringify({ repo: join(tmp, 'does-not-exist'), mtime: 0, routes: [] }),
      'utf8',
    );
    await writeFile(corruptEntry, 'not json', 'utf8');

    const pruned = await pruneOrphanRouteCaches(cacheDir);
    expect(pruned).toBe(2);
    expect(existsSync(liveEntry)).toBe(true);
    expect(existsSync(orphanEntry)).toBe(false);
    expect(existsSync(corruptEntry)).toBe(false);
  });

  it('buildMergedGraph prunes orphans as a side-effect', async () => {
    const routesDir = join(cacheDir, 'routes');
    await mkdir(routesDir, { recursive: true });
    await writeFile(
      join(routesDir, 'orphan.json'),
      JSON.stringify({ repo: '/no/such/repo', mtime: 0, routes: [] }),
      'utf8',
    );
    await writeGraph(repoA, [{ id: 'fn1', label: 'handle' }]);
    const group: ForgeGroup = { repos: [repoA] };
    await buildMergedGraph(group, { cacheDir });
    expect(existsSync(join(routesDir, 'orphan.json'))).toBe(false);
  });

  it('busts route cache when OpenAPI spec on the shelf changes', async () => {
    // Shelf mtime must participate in the per-repo fingerprint — otherwise
    // editing a spec via `forge capture-spec` would silently return stale
    // route edges until someone bumps the graph.
    const shelfDir = join(tmp, 'specs');
    await mkdir(shelfDir, { recursive: true });
    const originalShelf = process.env.METALMIND_SHELF_DIR;
    process.env.METALMIND_SHELF_DIR = shelfDir;
    try {
      const repoBasename = repoA.split('/').pop();
      const specPath = join(shelfDir, `${repoBasename}.yaml`);
      await writeGraph(repoA, [{ id: 'fn', label: 'handle' }]);

      const specV1 = `openapi: 3.0.0\npaths:\n  /users:\n    get:\n      operationId: getUsers\n`;
      await writeFile(specPath, specV1, 'utf8');

      const group: ForgeGroup = { repos: [repoA] };
      const first = await loadOrBuildMerged('g', group, { cacheDir });
      const firstRoutes = first.routeMatchEdgeCount;

      await new Promise((r) => setTimeout(r, 20));
      const specV2 = `${specV1}  /orders:\n    get:\n      operationId: getOrders\n`;
      await writeFile(specPath, specV2, 'utf8');

      const second = await loadOrBuildMerged('g', group, { cacheDir });
      expect(second.generatedAt).not.toBe(first.generatedAt);
      // Route count may be the same for a single-repo forge (no cross-repo
      // match target), but the cache must rebuild — generatedAt proves that.
      expect(second.routeMatchEdgeCount).toBeGreaterThanOrEqual(firstRoutes);
    } finally {
      if (originalShelf === undefined) delete process.env.METALMIND_SHELF_DIR;
      else process.env.METALMIND_SHELF_DIR = originalShelf;
    }
  });

  it('loadOrBuildMerged prunes orphans even on the warm cache hit path', async () => {
    const routesDir = join(cacheDir, 'routes');
    await mkdir(routesDir, { recursive: true });
    await writeGraph(repoA, [{ id: 'fn1', label: 'handle' }]);
    const group: ForgeGroup = { repos: [repoA] };
    // Build once to populate the merged cache.
    await loadOrBuildMerged('warm', group, { cacheDir });
    // Drop in an orphan after the cache is warm.
    await writeFile(
      join(routesDir, 'orphan.json'),
      JSON.stringify({ repo: '/still/no/such/repo', mtime: 0, routes: [] }),
      'utf8',
    );
    // Warm cache hit — buildMergedGraph would not run, but prune should still fire.
    await loadOrBuildMerged('warm', group, { cacheDir });
    expect(existsSync(join(routesDir, 'orphan.json'))).toBe(false);
  });
});
