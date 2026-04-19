import { log } from '@clack/prompts';
import { type RecallTier, recall } from '../backends/recall.js';
import { readConfig } from '../config.js';

export interface TapOptions {
  deep?: boolean;
  expand?: boolean;
  k?: number;
}

function resolveTier(opts: TapOptions, defaultTier: RecallTier): RecallTier {
  if (opts.expand) return 'expand';
  if (opts.deep) return 'deep';
  return defaultTier;
}

export async function tap(query: string | undefined, opts: TapOptions = {}): Promise<void> {
  if (!query?.trim()) {
    log.error('Usage: metalmind tap copper "<query>"');
    process.exitCode = 1;
    return;
  }

  const config = await readConfig();
  if (!config) {
    log.error('No metalmind config. Run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }

  const tier = resolveTier(opts, config.recall.defaultTier);

  try {
    const result = await recall({
      vaultPath: config.vaultPath,
      query,
      tier,
      k: opts.k,
    });
    log.info(`${tier} via ${result.tool}`);
    process.stdout.write(`${result.text}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`tap failed: ${message}`);
    process.exitCode = 1;
  }
}
