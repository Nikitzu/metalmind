import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, writeSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CONFIG_DIR, CONFIG_PATH } from '../config.js';

export interface AutoStampPaths {
  config: string;
  marker: string;
  lock: string;
  log: string;
}

export const AUTO_STAMP_PATHS: AutoStampPaths = {
  config: CONFIG_PATH,
  marker: join(CONFIG_DIR, 'stamped-version'),
  lock: join(CONFIG_DIR, 'auto-stamp.lock'),
  log: join(CONFIG_DIR, 'logs', 'auto-stamp.log'),
};

const SELF_STAMPING = new Set(['init', 'stamp', 'brass', 'uninstall']);
const STALE_LOCK_MS = 10 * 60 * 1000;

export type SpawnFn = (
  args: string[],
  options: { stdio: ['ignore', number, number]; env: NodeJS.ProcessEnv },
) => number;

export type AutoStampResult = 'skipped' | 'locked' | 'stamped' | 'failed';

export async function readStampedVersion(
  file: string = AUTO_STAMP_PATHS.marker,
): Promise<string | null> {
  try {
    return (await readFile(file, 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

export async function writeStampedVersion(
  version: string,
  file: string = AUTO_STAMP_PATHS.marker,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${version}\n`, 'utf8');
}

export function shouldAutoStamp(opts: {
  installed: boolean;
  stamped: string | null;
  current: string;
  commands: string[];
  env: NodeJS.ProcessEnv;
}): boolean {
  if (!opts.installed) return false;
  if (opts.env.METALMIND_NO_AUTO_STAMP === '1') return false;
  if (opts.commands.some((c) => SELF_STAMPING.has(c))) return false;
  return opts.stamped !== opts.current;
}

async function acquireLock(lock: string): Promise<boolean> {
  try {
    await mkdir(lock);
    return true;
  } catch {
    try {
      if (Date.now() - (await stat(lock)).mtimeMs < STALE_LOCK_MS) return false;
      await rm(lock, { recursive: true, force: true });
      await mkdir(lock);
      return true;
    } catch {
      return false;
    }
  }
}

const defaultSpawn: SpawnFn = (args, options) =>
  spawnSync(process.execPath, [...process.execArgv, process.argv[1] ?? '', ...args], options)
    .status ?? 1;

export async function runAutoStamp(opts: {
  current: string;
  commands: string[];
  paths?: AutoStampPaths;
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnFn;
}): Promise<AutoStampResult> {
  const paths = opts.paths ?? AUTO_STAMP_PATHS;
  const env = opts.env ?? process.env;
  const stamped = await readStampedVersion(paths.marker);
  const run = shouldAutoStamp({
    installed: existsSync(paths.config),
    stamped,
    current: opts.current,
    commands: opts.commands,
    env,
  });
  if (!run) return 'skipped';
  await mkdir(dirname(paths.lock), { recursive: true });
  if (!(await acquireLock(paths.lock))) return 'locked';
  try {
    await mkdir(dirname(paths.log), { recursive: true });
    const fd = openSync(paths.log, 'a');
    try {
      writeSync(
        fd,
        `\n== ${new Date().toISOString()} auto-stamp ${stamped ?? 'unrecorded'} -> ${opts.current}\n`,
      );
      const status = (opts.spawn ?? defaultSpawn)(['stamp', '--no-prompt'], {
        stdio: ['ignore', fd, fd],
        env: { ...env, METALMIND_NO_AUTO_STAMP: '1' },
      });
      return status === 0 ? 'stamped' : 'failed';
    } finally {
      closeSync(fd);
    }
  } finally {
    await rm(paths.lock, { recursive: true, force: true });
  }
}
