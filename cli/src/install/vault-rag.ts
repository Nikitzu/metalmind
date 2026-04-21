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
  return res.stdout
    .split('\n')
    .some((line) => line.trim().startsWith(VAULT_RAG_PACKAGE));
}

export async function installVaultRag(
  opts: InstallVaultRagOptions = {},
): Promise<InstallVaultRagResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const packageDir = join(templatesDir, 'vault-rag-pkg');

  let installed = false;
  let alreadyInstalled = false;

  const target = (opts.extras && opts.extras.length > 0)
    ? `${VAULT_RAG_PACKAGE}[${opts.extras.join(',')}]`
    : VAULT_RAG_PACKAGE;

  if (!opts.reinstall && (await isVaultRagInstalled()) && !opts.extras?.length) {
    alreadyInstalled = true;
  } else if (!opts.skipToolInstall) {
    const args = [
      'tool',
      'install',
      ...(opts.reinstall || opts.extras?.length ? ['--reinstall', '--force'] : []),
      '--from',
      packageDir,
      target,
    ];
    const res = await runCommand('uv', args, { timeoutMs: 900_000 });
    if (!res.ok) {
      throw new Error(`uv tool install ${target} failed: ${res.stderr || res.stdout}`);
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
