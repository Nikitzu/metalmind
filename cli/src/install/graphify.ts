import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
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
  legacyHomeStampRemoved: boolean;
}

/**
 * graphify claude install stamps a `CLAUDE.md` in the inherited cwd as part
 * of its install. We don't want that file in $HOME — it would inject
 * graphify-specific instructions into every Claude Code session under
 * $HOME, including unrelated repos. Strip the graphify section if it
 * exists and the file is otherwise empty (or remove the section but keep
 * the rest of user content).
 */
const GRAPHIFY_STAMP_PREFIX = '## graphify';

export async function cleanLegacyHomeClaudeMdStamp(homeDir: string = homedir()): Promise<boolean> {
  const path = join(homeDir, 'CLAUDE.md');
  if (!existsSync(path)) return false;
  const current = await readFile(path, 'utf8');
  if (!current.includes(GRAPHIFY_STAMP_PREFIX)) return false;

  // Strip from `## graphify` to either the next H2 or end of file.
  const start = current.indexOf(GRAPHIFY_STAMP_PREFIX);
  const afterStart = start + GRAPHIFY_STAMP_PREFIX.length;
  const nextHeadingMatch = current.slice(afterStart).match(/\n## /);
  const end =
    nextHeadingMatch && typeof nextHeadingMatch.index === 'number'
      ? afterStart + nextHeadingMatch.index + 1
      : current.length;
  const next = (current.slice(0, start) + current.slice(end)).replace(/\n{3,}/g, '\n\n').trimEnd();

  if (next.trim().length === 0) {
    await rm(path, { force: true });
  } else {
    await writeFile(path, `${next}\n`, 'utf8');
  }
  return true;
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
    // `graphify claude install` writes its `## graphify` block into the
    // CLAUDE.md of the cwd it inherits. We only want the user-scope effect
    // (the conditional PreToolUse hook in ~/.claude/settings.json), NOT a
    // CLAUDE.md stamp at $HOME — that would inject graphify-specific
    // instructions into every Claude Code session under $HOME, including
    // unrelated repos. Workaround: spawn from a throwaway temp dir, then
    // delete it. graphify writes ~/.claude/settings.json from a fixed path
    // regardless of cwd, so the hook still lands correctly.
    const sandbox = await mkdtemp(join(tmpdir(), 'metalmind-graphify-'));
    try {
      const res = await runCommand(GRAPHIFY_BIN, ['claude', 'install'], {
        timeoutMs: 30_000,
        cwd: sandbox,
      });
      if (!res.ok) {
        throw new Error(`graphify claude install failed: ${res.stderr || res.stdout}`);
      }
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
    claudeWired = true;
  }

  // Legacy cleanup: previous metalmind versions ran `graphify claude install`
  // with cwd=$HOME (or, before 0.5.5, the user's launch cwd which often was
  // $HOME). Strip the resulting stamp from ~/CLAUDE.md on every init so
  // users who upgrade get clean state without manual intervention.
  const legacyHomeStampRemoved = await cleanLegacyHomeClaudeMdStamp();

  return { installed, alreadyInstalled, claudeWired, legacyHomeStampRemoved };
}

export async function uninstallGraphify(): Promise<{
  claudeUnwired: boolean;
  uninstalled: boolean;
}> {
  let claudeUnwired = false;
  if (await isGraphifyInstalled()) {
    const sandbox = await mkdtemp(join(tmpdir(), 'metalmind-graphify-'));
    try {
      const unwire = await runCommand(GRAPHIFY_BIN, ['claude', 'uninstall'], {
        timeoutMs: 30_000,
        cwd: sandbox,
      });
      claudeUnwired = unwire.ok;
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }
  await cleanLegacyHomeClaudeMdStamp();
  const uninstall = await runCommand('uv', ['tool', 'uninstall', GRAPHIFY_PACKAGE], {
    timeoutMs: 60_000,
  });
  return { claudeUnwired, uninstalled: uninstall.ok };
}
