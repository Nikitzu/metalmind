import { runCommand } from '../util/exec.js';

export const GRAPHIFY_PACKAGE = 'graphifyy';
export const GRAPHIFY_BIN = 'graphify';

export interface InstallGraphifyOptions {
  skipToolInstall?: boolean;
  skipClaudeWire?: boolean;
}

export interface InstallGraphifyResult {
  installed: boolean;
  alreadyInstalled: boolean;
  claudeWired: boolean;
}

async function isGraphifyInstalled(): Promise<boolean> {
  const res = await runCommand(GRAPHIFY_BIN, ['--version']);
  return res.ok;
}

export async function installGraphify(
  opts: InstallGraphifyOptions = {},
): Promise<InstallGraphifyResult> {
  let installed = false;
  let alreadyInstalled = false;

  if (await isGraphifyInstalled()) {
    alreadyInstalled = true;
  } else if (!opts.skipToolInstall) {
    const res = await runCommand('uv', ['tool', 'install', GRAPHIFY_PACKAGE], {
      timeoutMs: 300_000,
    });
    if (!res.ok) {
      throw new Error(`uv tool install ${GRAPHIFY_PACKAGE} failed: ${res.stderr || res.stdout}`);
    }
    installed = true;
  }

  let claudeWired = false;
  if (!opts.skipClaudeWire && (installed || alreadyInstalled)) {
    const res = await runCommand(GRAPHIFY_BIN, ['claude', 'install'], { timeoutMs: 30_000 });
    if (!res.ok) {
      throw new Error(`graphify claude install failed: ${res.stderr || res.stdout}`);
    }
    claudeWired = true;
  }

  return { installed, alreadyInstalled, claudeWired };
}

export async function uninstallGraphify(): Promise<{
  claudeUnwired: boolean;
  uninstalled: boolean;
}> {
  let claudeUnwired = false;
  if (await isGraphifyInstalled()) {
    const unwire = await runCommand(GRAPHIFY_BIN, ['claude', 'uninstall'], { timeoutMs: 30_000 });
    claudeUnwired = unwire.ok;
  }
  const uninstall = await runCommand('uv', ['tool', 'uninstall', GRAPHIFY_PACKAGE], {
    timeoutMs: 60_000,
  });
  return { claudeUnwired, uninstalled: uninstall.ok };
}
