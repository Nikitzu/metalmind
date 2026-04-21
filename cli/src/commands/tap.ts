import { log } from '@clack/prompts';
import { type RecallTier, recall } from '../backends/recall.js';
import { ensureRerankExtra } from '../backends/rerank-bootstrap.js';
import { listRecentNotes } from '../backends/vault-browse.js';
import { readConfig } from '../config.js';

export interface TapOptions {
  deep?: boolean;
  expand?: boolean;
  rerank?: boolean;
  k?: number;
  json?: boolean;
  verbose?: boolean;
  listRecent?: number;
}

function resolveTier(opts: TapOptions, defaultTier: RecallTier): RecallTier {
  if (opts.expand) return 'expand';
  if (opts.deep) return 'deep';
  return defaultTier;
}

export async function tap(query: string | undefined, opts: TapOptions = {}): Promise<void> {
  const config = await readConfig();
  if (!config) {
    log.error('No metalmind config. Run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }

  if (opts.listRecent !== undefined) {
    const notes = await listRecentNotes(config.vaultPath, opts.listRecent);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(notes, null, 2)}\n`);
      return;
    }
    for (const n of notes) {
      const iso = new Date(n.modifiedMs).toISOString().slice(0, 10);
      process.stdout.write(`\n${iso}  ${n.relPath}\n  ${n.title}\n`);
      if (n.excerpt) process.stdout.write(`  ${n.excerpt}\n`);
    }
    return;
  }

  if (!query?.trim()) {
    log.error('Usage: metalmind tap copper "<query>"  |  metalmind tap copper --list-recent N');
    process.exitCode = 1;
    return;
  }

  const tier = resolveTier(opts, config.recall.defaultTier);
  const showMeta = opts.verbose ?? config.verbose;

  if (opts.rerank) {
    // One-time bootstrap: installs `metalmind-vault-rag[rerank]` and kicks the
    // watcher so the new process picks up FlagEmbedding. No-op after the first
    // successful call. Falls through silently if the watcher HTTP endpoint is
    // unreachable (stdio MCP fallback still works without rerank).
    const ready = await ensureRerankExtra({
      httpEndpoint: config.recall.httpEndpoint,
      onProgress: (msg) => log.info(msg),
    });
    if (!ready && showMeta) {
      log.warn('rerank bootstrap incomplete — proceeding without rerank.');
    }
  }

  try {
    const result = await recall({
      vaultPath: config.vaultPath,
      query,
      tier,
      k: opts.k,
      rerank: opts.rerank,
      verbose: showMeta,
      httpEndpoint: config.recall.httpEndpoint,
    });
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ tier, query, text: result.text, raw: result.raw }, null, 2)}\n`,
      );
      return;
    }
    if (showMeta) log.info(`${tier} (${query.length} chars)`);
    process.stdout.write(`${result.text}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`tap failed: ${message}`);
    process.exitCode = 1;
  }
}
