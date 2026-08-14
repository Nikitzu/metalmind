import { log } from '@clack/prompts';
import { recallAuthHeaders } from '../backends/recall-token.js';
import { readConfig } from '../config.js';
import { runCommand } from '../util/exec.js';

const DEFAULT_HTTP_ENDPOINT = 'http://127.0.0.1:17317';
const HTTP_TIMEOUT_MS = 5_000;

export interface IndexStatus {
  stamped: boolean;
  stale: boolean;
  expected_format_version: number;
  expected_embedder: string;
  format_version: number | null;
  embedder: string | null;
  chunker: string | null;
  max_chunk_chars: number | null;
  files: number | null;
  chunks: number | null;
  built_at: string | null;
  bands: { low_edge: number; high_edge: number } | null;
}

function endpoint(): string {
  return process.env.METALMIND_RECALL_HTTP || DEFAULT_HTTP_ENDPOINT;
}

export type IndexStatusResult =
  | { ok: true; status: IndexStatus }
  | { ok: false; reason: 'unreachable' | 'unsupported' };

export async function fetchIndexStatus(): Promise<IndexStatusResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${endpoint()}/index/status`, {
      headers: await recallAuthHeaders(),
      signal: controller.signal,
    });
    if (res.status === 404) return { ok: false, reason: 'unsupported' };
    if (!res.ok) return { ok: false, reason: 'unreachable' };
    return { ok: true, status: (await res.json()) as IndexStatus };
  } catch {
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

function shortTime(iso: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export function renderIndexStatus(s: IndexStatus): string {
  const lines: string[] = [];

  if (!s.stamped) {
    lines.push('  format:    not stamped yet');
    lines.push('  the watcher records it the next time it starts');
  } else {
    const currency = s.stale ? 'STALE' : 'current';
    lines.push(`  format:    ${s.format_version} (${currency})`);
    lines.push(`  embedder:  ${s.embedder}`);
    lines.push(`  chunks:    ${s.chunks} from ${s.files} files`);
    lines.push(`  built:     ${shortTime(s.built_at)}`);
  }

  lines.push(
    s.bands
      ? `  bands:     low ${s.bands.low_edge.toFixed(4)}  high ${s.bands.high_edge.toFixed(4)}`
      : '  bands:     not calibrated',
  );

  if (s.stale) {
    lines.push('');
    lines.push(
      `  This index was built in format ${s.format_version} by ${s.embedder}; ` +
        `this release builds format ${s.expected_format_version} with ${s.expected_embedder}.`,
    );
    lines.push('  Recall still works. Run `metalmind index rebuild` to update it.');
  }

  return lines.join('\n');
}

export async function indexStatusCmd(): Promise<void> {
  const result = await fetchIndexStatus();
  if (!result.ok) {
    log.error(
      result.reason === 'unsupported'
        ? 'The running watcher predates this command. Run `metalmind stamp` to refresh it.'
        : 'Could not reach the watcher. Start it, or run `metalmind pulse` to diagnose.',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${renderIndexStatus(result.status)}\n`);
}


export async function indexRebuildCmd(): Promise<void> {
  const config = await readConfig();
  if (!config) {
    log.error('No vault configured. Run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }

  log.info(`Rebuilding the index for ${config.vaultPath}. This runs for minutes on a large vault.`);
  const res = await runCommand('metalmind-vault-rag-indexer', [], {
    inheritStdio: true,
    timeoutMs: 0,
    env: { ...process.env, VAULT_PATH: config.vaultPath },
  });

  if (!res.ok) {
    log.error('Rebuild failed. The previous index is untouched.');
    process.exitCode = 1;
    return;
  }
  log.success('Index rebuilt, format recorded, confidence recalibrated.');
}
