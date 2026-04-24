import { log } from '@clack/prompts';
import { readConfig } from '../config.js';
import { type DailyOpts, dailyAdd, dailyNew } from '../scribe/daily.js';

function fail(message: string): void {
  log.error(message);
  process.exitCode = 1;
}

async function ctx(): Promise<DailyOpts> {
  const cfg = await readConfig();
  if (!cfg) throw new Error('metalmind not initialized - run `metalmind init` first');
  return { vaultRoot: cfg.vaultPath };
}

export async function atiumNewCmd(opts: {
  date?: string;
  from?: string;
  dryRun?: boolean;
}): Promise<void> {
  try {
    const res = await dailyNew(opts, await ctx());
    const carriedNote =
      res.carried > 0 ? ` (carried ${res.carried} item${res.carried === 1 ? '' : 's'})` : '';
    log.success(`${opts.dryRun ? 'would create' : 'created'} ${res.relPath}${carriedNote}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function atiumAddCmd(
  item: string,
  opts: { date?: string; dryRun?: boolean },
): Promise<void> {
  try {
    const res = await dailyAdd(item, opts, await ctx());
    const verb = opts.dryRun ? 'would add to' : res.created ? 'created and added to' : 'added to';
    log.success(`${verb} ${res.relPath}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
