import { confirm, isCancel, log } from '@clack/prompts';
import { analyzeRepo, findRepoRoot, graphifyQuery, hasGraph } from '../backends/graphify.js';

export type BurnMetal = 'bronze' | 'iron';

export interface BurnOptions {
  metal: BurnMetal;
  input: string;
  skipIndexPrompt?: boolean;
  assumeYes?: boolean;
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

export async function burn(opts: BurnOptions): Promise<void> {
  if (!opts.input.trim()) {
    log.error(`Usage: metalmind burn ${opts.metal} "<value>"`);
    process.exitCode = 1;
    return;
  }

  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    log.error('Not inside a git repository. `burn` commands run per-repo.');
    process.exitCode = 1;
    return;
  }

  const ready = await ensureGraph(repoRoot, opts);
  if (!ready) {
    log.info('Graph not available — skipping.');
    return;
  }

  const query = opts.metal === 'iron' ? ironQuery(opts.input) : opts.input;

  try {
    const output = await graphifyQuery({ query, repoRoot });
    process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`burn ${opts.metal} failed: ${message}`);
    process.exitCode = 1;
  }
}
