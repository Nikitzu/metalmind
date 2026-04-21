import { installVaultRag } from '../install/vault-rag.js';
import { restartWatcher } from '../install/watcher-restart.js';

const DEFAULT_HTTP_ENDPOINT = 'http://127.0.0.1:17317';
const STATUS_TIMEOUT_MS = 2_000;
// Polling the /rerank/status endpoint after the watcher restart. The new
// Python process needs a few hundred ms to bind the port. Cap the wait.
const POST_RESTART_POLL_MS = 10_000;
const POST_RESTART_INTERVAL_MS = 250;

export interface EnsureRerankOptions {
  httpEndpoint?: string | null;
  /** When given, called with progress milestones so the caller can render a
   *  live log line. Default: no-op. */
  onProgress?: (msg: string) => void;
}

function endpoint(override?: string | null): string {
  return override || process.env.METALMIND_RECALL_HTTP || DEFAULT_HTTP_ENDPOINT;
}

async function rerankStatus(ep: string): Promise<boolean | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    const res = await fetch(`${ep}/rerank/status`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = (await res.json()) as { available?: boolean };
    return typeof body.available === 'boolean' ? body.available : null;
  } catch {
    return null;
  }
}

/** Ensure the `--rerank` recall tier is ready to use on this laptop. If the
 *  Python-side `FlagEmbedding` dep is missing, run the one-time `[rerank]`
 *  extra install and restart the watcher so the new process picks it up.
 *
 *  Returns `true` when rerank is (or was just made) available. Returns `false`
 *  when the watcher HTTP endpoint is unreachable — caller decides whether to
 *  fall through to stdio or abort. Surfaces install errors via thrown Error.
 */
export async function ensureRerankExtra(opts: EnsureRerankOptions = {}): Promise<boolean> {
  const ep = endpoint(opts.httpEndpoint);
  const progress = opts.onProgress ?? (() => {});

  const initial = await rerankStatus(ep);
  if (initial === true) return true;
  if (initial === null) {
    // HTTP endpoint unreachable. Don't install behind the user's back if we
    // can't see the watcher — they may be running the stdio path.
    return false;
  }

  progress('enabling reranker — one-time install (~1.2 GB: torch + FlagEmbedding + model on first use)…');
  await installVaultRag({ extras: ['rerank'] });
  progress('restarting watcher so the new dep is picked up…');
  const outcome = await restartWatcher();
  if (outcome === 'no-unit-found') {
    progress(
      'watcher unit not found — if you run the watcher manually, restart it yourself before retrying.',
    );
    return false;
  }

  const deadline = Date.now() + POST_RESTART_POLL_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POST_RESTART_INTERVAL_MS));
    const after = await rerankStatus(ep);
    if (after === true) {
      progress('reranker ready.');
      return true;
    }
  }
  progress('reranker install reported success but /rerank/status never flipped — retry `--rerank`.');
  return false;
}
