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

async function writeSymbols(repo: string, names: string[]): Promise<void> {
  const body = names.map((n) => `export class ${n} {}`).join('\n');
  await writeFile(join(repo, 'symbols.ts'), `${body}\n`, 'utf8');
}

async function touchManifest(repo: string, version: string): Promise<void> {
  await writeFile(join(repo, 'package.json'), JSON.stringify({ version }), 'utf8');
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

  it('drops a label shared by too many nodes - a naming convention, not a shared concept, and quadratic to pair', () => {
    const nodes = Array.from({ length: 60 }, (_, i) => ({
      id: `r${i % 3}::n${i}`,
      label: 'Repository',
      repo: `/r${i % 3}`,
    }));
    expect(buildNameMatchEdges(nodes)).toHaveLength(0);
  });

  it('buildMergedGraph extracts symbols from source and unions repos', async () => {
    await writeSymbols(repoA, ['AuthService']);
    await writeSymbols(repoB, ['AuthService']);

    const group: ForgeGroup = { repos: [repoA, repoB] };
    const merged = await buildMergedGraph(group);

    expect(merged.nodeCount).toBe(2);
    expect(merged.nodes.map((n) => n.label)).toEqual(['AuthService', 'AuthService']);
    expect(merged.nodes.map((n) => n.repo).sort()).toEqual([repoA, repoB].sort());
    expect(merged.nameMatchEdgeCount).toBe(1);
    expect(merged.edges[0]?.confidence).toBe('INFERRED_NAME');
  });

  it('skips repos with no extractable symbols', async () => {
    await writeSymbols(repoA, ['AuthService']);
    const group: ForgeGroup = { repos: [repoA, repoB] };
    const merged = await buildMergedGraph(group);
    expect(merged.nodeCount).toBe(1);
  });

  it('caches per-repo extraction by repo fingerprint; skips rewalk when unchanged', async () => {
    await touchManifest(repoA, '1.0.0');
    await writeSymbols(repoA, ['AuthService']);
    const group: ForgeGroup = { repos: [repoA] };

    const first = await buildMergedGraph(group, { cacheDir });
    expect(first.nodeCount).toBe(1);

    await writeSymbols(repoA, ['AuthService', 'BillingService']);
    const second = await buildMergedGraph(group, { cacheDir });
    expect(second.nodeCount).toBe(1);

    await new Promise((r) => setTimeout(r, 10));
    await touchManifest(repoA, '1.0.1');
    const third = await buildMergedGraph(group, { cacheDir });
    expect(third.nodeCount).toBe(2);
  });

  it('a staged git change busts the cache without touching a manifest', async () => {
    const gitDir = join(repoA, '.git');
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
    await writeSymbols(repoA, ['AuthService']);
    const group: ForgeGroup = { repos: [repoA] };

    const first = await loadOrBuildMerged('g', group, { cacheDir });
    expect(first.nodeCount).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    await writeSymbols(repoA, ['AuthService', 'LogoutService']);
    await writeFile(join(gitDir, 'index'), 'staged', 'utf8');

    const second = await loadOrBuildMerged('g', group, { cacheDir });
    expect(second.nodeCount).toBe(2);
  });

  it('pruneOrphanRouteCaches also sweeps the symbol cache', async () => {
    const symbolsDir = join(cacheDir, 'symbols');
    await mkdir(symbolsDir, { recursive: true });
    const orphanEntry = join(symbolsDir, 'orphan.json');
    await writeFile(
      orphanEntry,
      JSON.stringify({ repo: join(tmp, 'gone'), mtime: 0, symbols: [] }),
      'utf8',
    );
    expect(await pruneOrphanRouteCaches(cacheDir)).toBe(1);
    expect(existsSync(orphanEntry)).toBe(false);
  });

  it('loadOrBuildMerged writes cache and reads it back', async () => {
    await writeSymbols(repoA, ['AuthService']);
    const group: ForgeGroup = { repos: [repoA] };

    const first = await loadOrBuildMerged('g', group, { cacheDir });
    const cacheFile = join(cacheDir, 'g.json');
    expect(existsSync(cacheFile)).toBe(true);

    // Small wait so the second call's cache-age check can't race with repo mtime.
    await new Promise((r) => setTimeout(r, 10));
    const second = await loadOrBuildMerged('g', group, { cacheDir });
    expect(second.generatedAt).toBe(first.generatedAt);
  });

  it('loadOrBuildMerged rebuilds when the repo fingerprint is newer than the cache', async () => {
    await touchManifest(repoA, '1.0.0');
    await writeSymbols(repoA, ['AuthService']);
    const group: ForgeGroup = { repos: [repoA] };

    const first = await loadOrBuildMerged('g', group, { cacheDir });
    await new Promise((r) => setTimeout(r, 20));
    await writeSymbols(repoA, ['AuthService', 'LogoutService']);
    await touchManifest(repoA, '1.0.1');
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
    await writeSymbols(repoA, ['HandlerService']);
    const group: ForgeGroup = { repos: [repoA] };
    await buildMergedGraph(group, { cacheDir });
    expect(existsSync(join(routesDir, 'orphan.json'))).toBe(false);
  });

  it('busts route cache when OpenAPI spec on the shelf changes', async () => {
    // Shelf mtime must participate in the per-repo fingerprint - otherwise
    // editing a spec via `forge capture-spec` would silently return stale
    // route edges until someone bumps the graph.
    const shelfDir = join(tmp, 'specs');
    await mkdir(shelfDir, { recursive: true });
    const originalShelf = process.env.METALMIND_SHELF_DIR;
    process.env.METALMIND_SHELF_DIR = shelfDir;
    try {
      const repoBasename = repoA.split('/').pop();
      const specPath = join(shelfDir, `${repoBasename}.yaml`);
      await writeSymbols(repoA, ['HandlerService']);

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
      // match target), but the cache must rebuild - generatedAt proves that.
      expect(second.routeMatchEdgeCount).toBeGreaterThanOrEqual(firstRoutes);
    } finally {
      if (originalShelf === undefined) delete process.env.METALMIND_SHELF_DIR;
      else process.env.METALMIND_SHELF_DIR = originalShelf;
    }
  });

  it('loadOrBuildMerged prunes orphans even on the warm cache hit path', async () => {
    const routesDir = join(cacheDir, 'routes');
    await mkdir(routesDir, { recursive: true });
    await writeSymbols(repoA, ['HandlerService']);
    const group: ForgeGroup = { repos: [repoA] };
    // Build once to populate the merged cache.
    await loadOrBuildMerged('warm', group, { cacheDir });
    // Drop in an orphan after the cache is warm.
    await writeFile(
      join(routesDir, 'orphan.json'),
      JSON.stringify({ repo: '/still/no/such/repo', mtime: 0, routes: [] }),
      'utf8',
    );
    // Warm cache hit - buildMergedGraph would not run, but prune should still fire.
    await loadOrBuildMerged('warm', group, { cacheDir });
    expect(existsSync(join(routesDir, 'orphan.json'))).toBe(false);
  });
});
