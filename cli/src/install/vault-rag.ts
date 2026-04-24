import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';
import { getTemplatesDir } from '../util/paths.js';

export const VAULT_RAG_PACKAGE = 'metalmind-vault-rag';
export const VAULT_RAG_SERVER_BIN = 'metalmind-vault-rag-server';
export const VAULT_RAG_WATCHER_BIN = 'metalmind-vault-rag-watcher';
export const VAULT_RAG_INDEXER_BIN = 'metalmind-vault-rag-indexer';
export const VAULT_RAG_DOCTOR_BIN = 'metalmind-vault-rag-doctor';

export interface InstallVaultRagOptions {
  templatesDir?: string;
  skipToolInstall?: boolean;
  reinstall?: boolean;
  /** Python-side optional extras to enable (e.g. `['rerank']` pulls torch +
   *  FlagEmbedding). Forwarded to `uv tool install` as
   *  `metalmind-vault-rag[rerank,...]`. Unknown extras raise at install. */
  extras?: string[];
}

export interface InstallVaultRagResult {
  installed: boolean;
  alreadyInstalled: boolean;
  packageDir: string;
}

async function isVaultRagInstalled(): Promise<boolean> {
  // `uv tool list` is non-blocking and authoritative — asking the server binary
  // for --help used to block on stdin (FastMCP ignores argv and starts the
  // stdio loop), racing the 5s default timeout every init.
  const res = await runCommand('uv', ['tool', 'list'], { timeoutMs: 10_000 });
  if (!res.ok) return false;
  return res.stdout.split('\n').some((line) => line.trim().startsWith(VAULT_RAG_PACKAGE));
}

async function installedVaultRagVersion(): Promise<string | null> {
  const res = await runCommand('uv', ['tool', 'list'], { timeoutMs: 10_000 });
  if (!res.ok) return null;
  for (const line of res.stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith(VAULT_RAG_PACKAGE)) continue;
    // Lines look like: "metalmind-vault-rag v0.1.0"
    const parts = t.split(/\s+/);
    const ver = parts[1]?.replace(/^v/, '') ?? null;
    return ver;
  }
  return null;
}

async function bundledVaultRagVersion(packageDir: string): Promise<string | null> {
  try {
    const toml = await readFile(join(packageDir, 'pyproject.toml'), 'utf8');
    const match = toml.match(/^\s*version\s*=\s*"([^"]+)"/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Probe the installed vault-rag venv for the `[rerank]` extra. Returns true
 *  iff FlagEmbedding is importable there — i.e. the user opted into the
 *  heavy rerank tier at some point. Lets `stamp` preserve that state on
 *  upgrade-triggered reinstall instead of silently dropping the extra. */
export async function hasRerankExtraInstalled(): Promise<boolean> {
  const res = await runCommand(
    'uv',
    ['tool', 'run', '--from', VAULT_RAG_PACKAGE, 'python', '-c', 'import FlagEmbedding'],
    { timeoutMs: 15_000 },
  );
  return res.ok;
}

export async function installVaultRag(
  opts: InstallVaultRagOptions = {},
): Promise<InstallVaultRagResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const packageDir = join(templatesDir, 'vault-rag-pkg');

  let installed = false;
  let alreadyInstalled = false;

  // uv `tool install --from <path> <pkg>[extra]` errors with "conflicts with
  // install request". The working incantation for a local path + extras is
  // `tool install <path>[extra]` (positional, no --from). Without extras, the
  // --from + package-name form stays — it's what every metalmind release since
  // v0.1.0 has used.
  const hasExtras = (opts.extras?.length ?? 0) > 0;

  // Version-aware reinstall: if an older vault-rag is already installed,
  // force-reinstall so the newer bundled code (e.g. v0.3.0's FTS5 writes,
  // the `transformers<5` pin on [rerank], the VAULT_HTTP_PORT env var) lands
  // on upgrade. Without this, `uv tool list` says "already installed" and we
  // skip — leaving users with stale code until they manually --force.
  let versionMismatch = false;
  let alreadyInstalledPackage = false;
  if (!opts.reinstall && !hasExtras) {
    const installedVer = await installedVaultRagVersion();
    if (installedVer !== null) {
      alreadyInstalledPackage = true;
      const bundled = await bundledVaultRagVersion(packageDir);
      if (bundled && bundled !== installedVer) versionMismatch = true;
    }
  }

  const forceFlags =
    opts.reinstall || hasExtras || versionMismatch ? ['--reinstall', '--force'] : [];
  const args = hasExtras
    ? ['tool', 'install', ...forceFlags, `${packageDir}[${opts.extras!.join(',')}]`]
    : ['tool', 'install', ...forceFlags, '--from', packageDir, VAULT_RAG_PACKAGE];

  if (
    !opts.reinstall &&
    !hasExtras &&
    !versionMismatch &&
    alreadyInstalledPackage
  ) {
    alreadyInstalled = true;
  } else if (!opts.skipToolInstall) {
    const res = await runCommand('uv', args, { timeoutMs: 900_000 });
    if (!res.ok) {
      const label = hasExtras
        ? `${VAULT_RAG_PACKAGE}[${opts.extras!.join(',')}]`
        : VAULT_RAG_PACKAGE;
      throw new Error(`uv tool install ${label} failed: ${res.stderr || res.stdout}`);
    }
    installed = true;
  }

  return { installed, alreadyInstalled, packageDir };
}

export async function resolveWatcherBinPath(): Promise<string> {
  // Retained for backwards compat; the watcher unit now invokes `uv tool run`
  // directly so this probe is only used as a sanity check that the package is installed.
  const res = await runCommand('which', [VAULT_RAG_WATCHER_BIN]);
  const path = res.stdout.trim();
  if (!res.ok || !path) {
    throw new Error(
      `${VAULT_RAG_WATCHER_BIN} not found on PATH after install — check uv tool bin dir is on your PATH`,
    );
  }
  return path;
}

export async function resolveUvBinPath(): Promise<string> {
  const res = await runCommand('which', ['uv']);
  const path = res.stdout.trim();
  if (!res.ok || !path) {
    throw new Error('uv not found on PATH — install uv first: https://docs.astral.sh/uv/');
  }
  return path;
}

export async function uninstallVaultRag(): Promise<{ uninstalled: boolean }> {
  if (!(await isVaultRagInstalled())) {
    return { uninstalled: false };
  }
  const res = await runCommand('uv', ['tool', 'uninstall', VAULT_RAG_PACKAGE], {
    timeoutMs: 60_000,
  });
  return { uninstalled: res.ok };
}
