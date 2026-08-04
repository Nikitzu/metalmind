// qmd adapter for the recall-v0 bench. Drives `qmd` (tobi/qmd 2.1.0+)
// via npx subprocess so the bench has zero install commitment.
//
// First-call cost: qmd downloads ~2 GB of GGUF models (embed + rerank +
// query expansion) into ~/.cache/qmd/models/. Cached across scales
// within a single bench run, and across bench runs.
//
// Index isolation: each scale gets its own sqlite DB via the INDEX_PATH
// env var. Teardown removes the DB file (plus -wal / -shm siblings).
//
// Failure mode: if qmd setup fails (network, missing prereqs), the
// adapter returns a stub query function that always returns []. The
// runner treats all qmd ranks as null and the column shows 'n/a'.

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';

const QMD_PKG = '@tobilu/qmd@latest';

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr || stdout}`));
    });
    child.on('error', reject);
  });
}

/**
 * Build a query function that drives qmd against an isolated index.
 *
 * @param {object} opts
 * @param {string} opts.vault    Absolute path to the vault directory.
 * @param {string} opts.indexPath Absolute path for qmd's sqlite DB.
 * @param {string} opts.configDir Absolute dir for qmd's YAML collection config (qmd persists collection metadata here, separate from INDEX_PATH).
 * @param {number} [opts.timeoutMs] Per-subprocess timeout (default 600s - first call downloads models).
 * @returns {Promise<{ query: (q: string, k: number) => Promise<Array<{file: string, score: number}>>, available: boolean, errorMessage?: string }>}
 */
export async function buildQmdScorer({ vault, indexPath, configDir, timeoutMs = 600_000 }) {
  const env = {
    ...process.env,
    INDEX_PATH: indexPath,
    // qmd writes collection metadata to ${QMD_CONFIG_DIR}/<index-name>.yml,
    // independent of INDEX_PATH. Without isolating it, every scale sees the
    // 'bench' collection from the previous scale's YAML and refuses to add.
    QMD_CONFIG_DIR: configDir,
  };

  try {
    await runCmd(
      'npx',
      ['-y', QMD_PKG, 'collection', 'add', vault, '--name', 'bench', '--mask', '**/*.md'],
      { env, timeout: timeoutMs },
    );
    await runCmd('npx', ['-y', QMD_PKG, 'embed'], { env, timeout: timeoutMs });
  } catch (err) {
    return {
      available: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      query: async () => [],
    };
  }

  return {
    available: true,
    query: async (q, k) => {
      try {
        const { stdout } = await runCmd(
          'npx',
          ['-y', QMD_PKG, 'query', q, '--json', '-n', String(k)],
          { env, timeout: timeoutMs },
        );
        const trimmed = stdout.trim();
        if (!trimmed) return [];
        const parsed = JSON.parse(trimmed);
        const rows = Array.isArray(parsed) ? parsed : (parsed.results ?? []);
        return rows.map((r) => ({
          // qmd reports paths relative to the vault root; bench scoring
          // uses basename matching so absolute vs relative doesn't matter.
          file: typeof r.file === 'string' ? r.file : (r.path ?? ''),
          score: typeof r.score === 'number' ? r.score : 0,
        }));
      } catch {
        return [];
      }
    },
  };
}

export async function teardownQmd(indexPath, configDir) {
  await Promise.all([
    rm(indexPath, { force: true }),
    rm(`${indexPath}-wal`, { force: true }),
    rm(`${indexPath}-shm`, { force: true }),
    configDir ? rm(configDir, { recursive: true, force: true }) : Promise.resolve(),
  ]);
}
