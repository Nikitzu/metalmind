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

describe('watcher dispatch', () => {
  let tmp: string;
  let templatesDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-watcher-'));
    templatesDir = join(tmp, 'templates');
    await mkdir(join(templatesDir, 'launchd'), { recursive: true });
    await mkdir(join(templatesDir, 'systemd'), { recursive: true });
    await writeFile(
      join(templatesDir, 'launchd', 'com.metalmind.vault-indexer.plist.template'),
      '<plist>{{WATCHER_BIN}} {{VAULT_PATH}} {{PATH_VALUE}}</plist>',
      'utf8',
    );
    await writeFile(
      join(templatesDir, 'systemd', 'metalmind-vault-indexer.service.template'),
      'ExecStart={{WATCHER_BIN}}\nVAULT_PATH={{VAULT_PATH}}\nPATH={{PATH_VALUE}}\n',
      'utf8',
    );
    runCommand.mockReset();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('darwin → installs launchd plist', async () => {
    const launchAgentsDir = join(tmp, 'LaunchAgents');
    runCommand.mockResolvedValue(ok());

    const { installWatcher } = await import('./watcher.js');
    const result = await installWatcher({
      platformOverride: 'darwin',
      vaultPath: '/v',
      watcherBin: '/bin/watcher',
      uvBin: '/opt/homebrew/bin/uv',
      templatesDir,
      launchAgentsDir,
    });

    expect(result.platform).toBe('darwin');
    expect(result.unitPath.endsWith('com.metalmind.vault-indexer.plist')).toBe(true);
    expect(result.wroteUnit).toBe(true);
    expect(existsSync(result.unitPath)).toBe(true);
  });

  it('linux → installs systemd user service', async () => {
    const systemdUserDir = join(tmp, 'systemd-user');
    runCommand.mockResolvedValue(ok());

    const { installWatcher } = await import('./watcher.js');
    const result = await installWatcher({
      platformOverride: 'linux',
      vaultPath: '/home/u/Knowledge',
      watcherBin: '/home/u/.local/bin/metalmind-vault-rag-watcher',
      uvBin: '/opt/homebrew/bin/uv',
      templatesDir,
      systemdUserDir,
    });

    expect(result.platform).toBe('linux');
    expect(result.unitPath.endsWith('metalmind-vault-indexer.service')).toBe(true);
    expect(result.wroteUnit).toBe(true);
    const contents = await readFile(result.unitPath, 'utf8');
    expect(contents).toContain('ExecStart=/home/u/.local/bin/metalmind-vault-rag-watcher');
  });

  it('linux skipStart writes unit without enabling', async () => {
    const systemdUserDir = join(tmp, 'systemd-user');
    const { installWatcher } = await import('./watcher.js');
    const result = await installWatcher({
      platformOverride: 'linux',
      vaultPath: '/v',
      watcherBin: '/b',
      uvBin: '/opt/homebrew/bin/uv',
      templatesDir,
      systemdUserDir,
      skipStart: true,
    });

    expect(result.wroteUnit).toBe(true);
    expect(result.started).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
  });
});
