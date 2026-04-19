import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../util/exec.js';

const runCommand = vi.hoisted(() =>
  vi.fn<(cmd: string, args?: string[], opts?: { timeoutMs?: number }) => Promise<CommandResult>>(),
);

vi.mock('../util/exec.js', () => ({ runCommand }));

function ok(stdout = ''): CommandResult {
  return { stdout, stderr: '', ok: true, exitCode: 0 };
}
function fail(stderr = 'fail'): CommandResult {
  return { stdout: '', stderr, ok: false, exitCode: 1 };
}

describe('serena install', () => {
  let tmp: string;
  let templatesDir: string;
  let serenaRoot: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-serena-'));
    templatesDir = join(tmp, 'templates');
    serenaRoot = join(tmp, '.serena');
    await mkdir(join(templatesDir, 'serena'), { recursive: true });
    await writeFile(
      join(templatesDir, 'serena', 'serena_config.yml'),
      'projects_dir: {{HOME}}/.serena/projects\n',
      'utf8',
    );
    runCommand.mockReset();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('runs uv tool install when serena is missing, stamps config', async () => {
    runCommand
      .mockResolvedValueOnce(fail('command not found')) // serena --version
      .mockResolvedValueOnce(ok()); // uv tool install

    const { installSerena } = await import('./serena.js');
    const result = await installSerena({
      templatesDir,
      serenaRoot,
      homeDir: '/Users/me',
    });

    expect(result.installed).toBe(true);
    expect(result.alreadyInstalled).toBe(false);
    expect(result.wroteConfig).toBe(true);
    expect(existsSync(result.configPath)).toBe(true);
    const config = await readFile(result.configPath, 'utf8');
    expect(config).toContain('/Users/me/.serena/projects');
    expect(runCommand).toHaveBeenCalledTimes(2);
    const installArgs = runCommand.mock.calls[1]?.[1];
    expect(installArgs).toEqual([
      'tool',
      'install',
      '-p',
      '3.13',
      'serena-agent@latest',
      '--prerelease=allow',
    ]);
  });

  it('skips uv tool install when serena already on PATH', async () => {
    runCommand.mockResolvedValueOnce(ok('serena 0.1.0'));

    const { installSerena } = await import('./serena.js');
    const result = await installSerena({ templatesDir, serenaRoot, homeDir: '/h' });

    expect(result.installed).toBe(false);
    expect(result.alreadyInstalled).toBe(true);
    expect(result.wroteConfig).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('preserves existing serena_config.yml', async () => {
    runCommand.mockResolvedValueOnce(ok('serena 0.1.0'));
    await mkdir(serenaRoot, { recursive: true });
    await writeFile(join(serenaRoot, 'serena_config.yml'), 'custom: true\n', 'utf8');

    const { installSerena } = await import('./serena.js');
    const result = await installSerena({ templatesDir, serenaRoot, homeDir: '/h' });

    expect(result.wroteConfig).toBe(false);
    const config = await readFile(result.configPath, 'utf8');
    expect(config).toBe('custom: true\n');
  });

  it('surfaces uv tool install failure', async () => {
    runCommand.mockResolvedValueOnce(fail('not found')).mockResolvedValueOnce(fail('network'));

    const { installSerena } = await import('./serena.js');
    await expect(installSerena({ templatesDir, serenaRoot, homeDir: '/h' })).rejects.toThrow(
      /uv tool install/,
    );
  });

  it('skipToolInstall path still stamps config', async () => {
    runCommand.mockResolvedValueOnce(fail('not found'));

    const { installSerena } = await import('./serena.js');
    const result = await installSerena({
      templatesDir,
      serenaRoot,
      homeDir: '/h',
      skipToolInstall: true,
    });

    expect(result.installed).toBe(false);
    expect(result.wroteConfig).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('uninstall runs uv tool uninstall when serena is present', async () => {
    runCommand.mockResolvedValueOnce(ok('serena 0.1.0')).mockResolvedValueOnce(ok());

    const { uninstallSerena } = await import('./serena.js');
    const result = await uninstallSerena();
    expect(result.uninstalled).toBe(true);
  });

  it('uninstall is no-op when serena is not installed', async () => {
    runCommand.mockResolvedValueOnce(fail('not found'));
    const { uninstallSerena } = await import('./serena.js');
    const result = await uninstallSerena();
    expect(result.uninstalled).toBe(false);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
