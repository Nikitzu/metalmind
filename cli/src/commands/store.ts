import { log } from '@clack/prompts';
import { saveToVault } from '../backends/vault.js';
import { readConfig } from '../config.js';
import { runCommand } from '../util/exec.js';

export interface StoreOptions {
  title?: string;
  tags?: string[];
  project?: string;
  /** Skip the synchronous incremental reindex. Watcher will eventually pick it up. */
  skipReindex?: boolean;
}

export async function store(content: string | undefined, opts: StoreOptions = {}): Promise<void> {
  if (!content?.trim()) {
    log.error('Usage: metalmind store copper "<insight>"');
    process.exitCode = 1;
    return;
  }

  const config = await readConfig();
  if (!config) {
    log.error('No metalmind config. Run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await saveToVault({
      vaultPath: config.vaultPath,
      content,
      title: opts.title,
      tags: opts.tags,
      project: opts.project,
    });
    log.success(`Stored → ${result.path}`);

    if (!opts.skipReindex) {
      const res = await runCommand('metalmind-vault-rag-indexer', ['--paths', result.path], {
        timeoutMs: 60_000,
      });
      if (res.ok) log.info('  indexed');
      else log.warn('  watcher will reindex (sync index failed silently)');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`store failed: ${message}`);
    process.exitCode = 1;
  }
}
