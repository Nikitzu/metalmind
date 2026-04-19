import { runCommand } from '../util/exec.js';

export const GRAPHIFY_PACKAGE = 'graphifyy';
export const GRAPHIFY_BIN = 'graphify';
/** Minimum graphify version that ships `graphify claude install`. Older releases lack the subcommand. */
export const GRAPHIFY_MIN_VERSION = '0.9.0';

export interface InstallGraphifyOptions {
  skipToolInstall?: boolean;
  skipClaudeWire?: boolean;
}

export interface InstallGraphifyResult {
  installed: boolean;
  alreadyInstalled: boolean;
  claudeWired: boolean;
}

function parseSemver(input: string): [number, number, number] | null {
  const match = input.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function semverGte(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
}

async function readGraphifyVersion(): Promise<string | null> {
  const res = await runCommand(GRAPHIFY_BIN, ['--version']);
  if (!res.ok) return null;
  return res.stdout.trim() || null;
}

async function isGraphifyInstalled(): Promise<boolean> {
  return (await readGraphifyVersion()) !== null;
}

export async function installGraphify(
  opts: InstallGraphifyOptions = {},
): Promise<InstallGraphifyResult> {
  let installed = false;
  let alreadyInstalled = false;

  const preVersion = await readGraphifyVersion();
  if (preVersion) {
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
    const version = installed ? await readGraphifyVersion() : preVersion;
    const parsed = version ? parseSemver(version) : null;
    const min = parseSemver(GRAPHIFY_MIN_VERSION);
    if (parsed && min && !semverGte(parsed, min)) {
      throw new Error(
        `graphify ${version} is too old (need ${GRAPHIFY_MIN_VERSION}+). Run \`uv tool upgrade graphifyy\` and re-run metalmind init.`,
      );
    }
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
