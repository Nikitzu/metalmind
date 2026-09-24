import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AutoStampPaths,
  readStampedVersion,
  runAutoStamp,
  shouldAutoStamp,
  writeStampedVersion,
} from './auto-stamp.js';

describe('shouldAutoStamp', () => {
  const base = {
    installed: true,
    stamped: '0.27.1',
    current: '0.29.0',
    commands: ['tap', 'copper'],
    env: {},
  };

  it('stamps an initialised install recorded at an older version', () => {
    expect(shouldAutoStamp(base)).toBe(true);
  });

  it('stamps an initialised install with no recorded version', () => {
    expect(shouldAutoStamp({ ...base, stamped: null })).toBe(true);
  });

  it('does nothing when the recorded version matches', () => {
    expect(shouldAutoStamp({ ...base, stamped: '0.29.0' })).toBe(false);
  });

  it('does nothing before init', () => {
    expect(shouldAutoStamp({ ...base, installed: false })).toBe(false);
  });

  it('leaves init, stamp, burn brass and uninstall alone', () => {
    for (const commands of [['init'], ['stamp'], ['burn', 'brass'], ['uninstall']]) {
      expect(shouldAutoStamp({ ...base, commands })).toBe(false);
    }
  });

  it('can be switched off with METALMIND_NO_AUTO_STAMP=1', () => {
    expect(shouldAutoStamp({ ...base, env: { METALMIND_NO_AUTO_STAMP: '1' } })).toBe(false);
  });
});

describe('stamped-version marker', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mm-autostamp-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips and reads a missing marker as null', async () => {
    const file = join(dir, 'stamped-version');
    expect(await readStampedVersion(file)).toBeNull();
    await writeStampedVersion('0.29.0', file);
    expect(await readStampedVersion(file)).toBe('0.29.0');
  });
});

describe('runAutoStamp', () => {
  let dir: string;
  let paths: AutoStampPaths;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mm-autostamp-'));
    await writeFile(join(dir, 'config.json'), '{}', 'utf8');
    paths = {
      config: join(dir, 'config.json'),
      marker: join(dir, 'stamped-version'),
      lock: join(dir, 'auto-stamp.lock'),
      log: join(dir, 'logs', 'auto-stamp.log'),
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs stamp --no-prompt in a child with output to the log and recursion off', async () => {
    const calls: { args: string[]; env: NodeJS.ProcessEnv; stdout: unknown }[] = [];
    const result = await runAutoStamp({
      current: '0.29.0',
      commands: ['scribe', 'list'],
      paths,
      env: {},
      spawn: (args, options) => {
        calls.push({ args, env: options.env, stdout: options.stdio[1] });
        return 0;
      },
    });
    expect(result).toBe('stamped');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.slice(-2)).toEqual(['stamp', '--no-prompt']);
    expect(calls[0]?.env.METALMIND_NO_AUTO_STAMP).toBe('1');
    expect(typeof calls[0]?.stdout).toBe('number');
    expect(existsSync(paths.log)).toBe(true);
    expect(existsSync(paths.lock)).toBe(false);
  });

  it('reports a failed stamp and releases the lock', async () => {
    const result = await runAutoStamp({
      current: '0.29.0',
      commands: ['scribe', 'list'],
      paths,
      env: {},
      spawn: () => 1,
    });
    expect(result).toBe('failed');
    expect(existsSync(paths.lock)).toBe(false);
  });

  it('skips when the recorded version is current', async () => {
    await writeFile(paths.marker, '0.29.0\n', 'utf8');
    let spawned = false;
    const result = await runAutoStamp({
      current: '0.29.0',
      commands: ['tap'],
      paths,
      env: {},
      spawn: () => {
        spawned = true;
        return 0;
      },
    });
    expect(result).toBe('skipped');
    expect(spawned).toBe(false);
  });

  it('does not start a second stamp while a fresh lock is held', async () => {
    await mkdir(paths.lock);
    const result = await runAutoStamp({
      current: '0.29.0',
      commands: ['tap'],
      paths,
      env: {},
      spawn: () => 0,
    });
    expect(result).toBe('locked');
  });

  it('breaks a lock older than ten minutes', async () => {
    await mkdir(paths.lock);
    const old = new Date(Date.now() - 11 * 60 * 1000);
    await utimes(paths.lock, old, old);
    const result = await runAutoStamp({
      current: '0.29.0',
      commands: ['tap'],
      paths,
      env: {},
      spawn: () => 0,
    });
    expect(result).toBe('stamped');
  });

  it('appends a header naming the versions to the log', async () => {
    await writeFile(paths.marker, '0.27.1\n', 'utf8');
    await runAutoStamp({
      current: '0.29.0',
      commands: ['tap'],
      paths,
      env: {},
      spawn: () => 0,
    });
    expect(await readFile(paths.log, 'utf8')).toContain('0.27.1 -> 0.29.0');
  });
});
