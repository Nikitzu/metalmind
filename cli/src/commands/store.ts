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

const REINDEX_HTTP_TIMEOUT_MS = 3_000;

async function reindexViaHttp(endpoint: string, paths: string[]): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REINDEX_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${endpoint}/reindex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
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
    if (result.deduped) {
      log.success(`Dedup: identical note already exists → ${result.path}`);
      return;
    }
    log.success(`Stored → ${result.path}`);

    if (!opts.skipReindex) {
      // Prefer the watcher's /reindex HTTP endpoint (sub-100ms, process already warm).
      // Fall back to spawning a one-shot indexer only if HTTP is unreachable.
      const endpoint =
        config.recall.httpEndpoint ??
        process.env.METALMIND_RECALL_HTTP ??
        'http://127.0.0.1:17317';
      const httpOk = await reindexViaHttp(endpoint, [result.path]);
      if (httpOk) {
        log.info('  indexed (via watcher HTTP)');
      } else {
        const res = await runCommand('metalmind-vault-rag-indexer', ['--paths', result.path], {
          timeoutMs: 60_000,
        });
        if (res.ok) log.info('  indexed (spawned indexer — watcher not running)');
        else log.warn('  watcher will reindex (sync index failed silently)');
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`store failed: ${message}`);
    process.exitCode = 1;
  }
}
