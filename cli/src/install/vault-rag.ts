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
}

export interface InstallVaultRagResult {
  installed: boolean;
  alreadyInstalled: boolean;
  packageDir: string;
}

async function isVaultRagInstalled(): Promise<boolean> {
  const res = await runCommand(VAULT_RAG_SERVER_BIN, ['--help']);
  return res.ok || /usage/i.test(res.stderr) || /usage/i.test(res.stdout);
}

export async function installVaultRag(
  opts: InstallVaultRagOptions = {},
): Promise<InstallVaultRagResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const packageDir = join(templatesDir, 'vault-rag-pkg');

  let installed = false;
  let alreadyInstalled = false;

  if (!opts.reinstall && (await isVaultRagInstalled())) {
    alreadyInstalled = true;
  } else if (!opts.skipToolInstall) {
    const args = [
      'tool',
      'install',
      ...(opts.reinstall ? ['--reinstall', '--force'] : []),
      '--from',
      packageDir,
      VAULT_RAG_PACKAGE,
    ];
    const res = await runCommand('uv', args, { timeoutMs: 300_000 });
    if (!res.ok) {
      throw new Error(`uv tool install ${VAULT_RAG_PACKAGE} failed: ${res.stderr || res.stdout}`);
    }
    installed = true;
  }

  return { installed, alreadyInstalled, packageDir };
}

export async function resolveWatcherBinPath(): Promise<string> {
  const res = await runCommand('which', [VAULT_RAG_WATCHER_BIN]);
  const path = res.stdout.trim();
  if (!res.ok || !path) {
    throw new Error(
      `${VAULT_RAG_WATCHER_BIN} not found on PATH after install — check uv tool bin dir is on your PATH`,
    );
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
