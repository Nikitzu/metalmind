import { confirm, isCancel, log } from '@clack/prompts';
import { analyzeRepo, findRepoRoot, graphifyQuery, hasGraph } from '../backends/graphify.js';
import {
  crossRepoHighlights,
  formatCrossRepoHighlight,
  loadOrBuildMerged,
} from '../forge/loader.js';
import { getForge } from '../forge/store.js';

export type BurnMetal = 'bronze' | 'iron';

export interface BurnOptions {
  metal: BurnMetal;
  input: string;
  skipIndexPrompt?: boolean;
  assumeYes?: boolean;
  forge?: string;
}

async function ensureGraph(repoRoot: string, opts: BurnOptions): Promise<boolean> {
  if (hasGraph(repoRoot)) return true;
  if (opts.skipIndexPrompt) {
    log.warn(
      `No graph at ${repoRoot}/graphify-out/graph.json. Use \`metalmind burn pewter\` to build.`,
    );
    return false;
  }
  let proceed = opts.assumeYes;
  if (proceed === undefined) {
    const answer = await confirm({
      message: `No graph for ${repoRoot}. Index now? (one-time, may take minutes)`,
      initialValue: true,
    });
    if (isCancel(answer)) return false;
    proceed = answer;
  }
  if (!proceed) return false;
  log.step(`Indexing ${repoRoot} with graphify…`);
  await analyzeRepo(repoRoot);
  return true;
}

function ironQuery(symbol: string): string {
  return `show details and neighbors of ${symbol}`;
}

async function burnSingleRepo(opts: BurnOptions, repoRoot: string): Promise<void> {
  const ready = await ensureGraph(repoRoot, opts);
  if (!ready) {
    log.info(`${repoRoot}: graph not available — skipping.`);
    return;
  }
  const query = opts.metal === 'iron' ? ironQuery(opts.input) : opts.input;
  const output = await graphifyQuery({ query, repoRoot });
  process.stdout.write(`\n=== ${repoRoot} ===\n`);
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
}

async function burnForge(opts: BurnOptions, forgeName: string): Promise<void> {
  const group = await getForge(forgeName);
  if (group.repos.length === 0) {
    log.error(`forge '${forgeName}' has no repos. Add some with \`metalmind forge add\`.`);
    process.exitCode = 1;
    return;
  }

  log.info(`Building merged graph for forge '${forgeName}' (${group.repos.length} repos)`);
  const merged = await loadOrBuildMerged(forgeName, group);
  log.success(
    `merged ${merged.nodeCount} nodes, ${merged.edgeCount} edges (` +
      `${merged.nameMatchEdgeCount} name-match, ${merged.routeMatchEdgeCount} route-match)`,
  );

  const highlights = crossRepoHighlights(merged, opts.input);
  if (highlights.length > 0) {
    process.stdout.write(
      `\n=== cross-repo matches (${highlights.length} inferred edge${highlights.length === 1 ? '' : 's'}) ===\n`,
    );
    for (const h of highlights) process.stdout.write(`${formatCrossRepoHighlight(h)}\n`);
  } else {
    log.info(`  no cross-repo matches for "${opts.input}" in inferred edges`);
  }

  for (const repo of group.repos) {
    try {
      await burnSingleRepo(opts, repo);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`${repo}: ${message}`);
    }
  }
}

export async function burn(opts: BurnOptions): Promise<void> {
  if (!opts.input.trim()) {
    log.error(`Usage: metalmind burn ${opts.metal} "<value>"`);
    process.exitCode = 1;
    return;
  }

  if (opts.forge) {
    try {
      await burnForge(opts, opts.forge);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`burn ${opts.metal} --forge ${opts.forge} failed: ${message}`);
      process.exitCode = 1;
    }
    return;
  }

  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    log.error('Not inside a git repository. `burn` commands run per-repo.');
    process.exitCode = 1;
    return;
  }

  try {
    await burnSingleRepo(opts, repoRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`burn ${opts.metal} failed: ${message}`);
    process.exitCode = 1;
  }
}
