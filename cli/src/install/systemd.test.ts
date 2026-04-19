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

describe('systemd watcher', () => {
  let tmp: string;
  let templatesDir: string;
  let systemdUserDir: string;

  const serviceTemplate = `[Unit]
Description=test
[Service]
ExecStart={{WATCHER_BIN}}
Environment=VAULT_PATH={{VAULT_PATH}}
Environment=PATH={{PATH_VALUE}}
`;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-systemd-'));
    templatesDir = join(tmp, 'templates');
    systemdUserDir = join(tmp, 'systemd-user');
    await mkdir(join(templatesDir, 'systemd'), { recursive: true });
    await writeFile(
      join(templatesDir, 'systemd', 'metalmind-vault-indexer.service.template'),
      serviceTemplate,
      'utf8',
    );
    runCommand.mockReset();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('renders service file with vaultPath + watcherBin substituted', async () => {
    runCommand
      .mockResolvedValueOnce(ok()) // daemon-reload
      .mockResolvedValueOnce(ok()); // enable --now

    const { installSystemdWatcher } = await import('./systemd.js');
    const result = await installSystemdWatcher({
      vaultPath: '/home/alice/Knowledge',
      watcherBin: '/home/alice/.local/bin/metalmind-vault-rag-watcher',
      templatesDir,
      systemdUserDir,
    });

    expect(result.wroteService).toBe(true);
    expect(result.enabled).toBe(true);
    const contents = await readFile(result.servicePath, 'utf8');
    expect(contents).toContain('ExecStart=/home/alice/.local/bin/metalmind-vault-rag-watcher');
    expect(contents).toContain('VAULT_PATH=/home/alice/Knowledge');
    expect(contents).not.toContain('{{');
  });

  it('preserves existing service on re-install', async () => {
    await mkdir(systemdUserDir, { recursive: true });
    const servicePath = join(systemdUserDir, 'metalmind-vault-indexer.service');
    await writeFile(servicePath, '# custom\n', 'utf8');
    runCommand.mockResolvedValue(ok());

    const { installSystemdWatcher } = await import('./systemd.js');
    const result = await installSystemdWatcher({
      vaultPath: '/v',
      watcherBin: '/b',
      templatesDir,
      systemdUserDir,
    });

    expect(result.wroteService).toBe(false);
    expect(await readFile(servicePath, 'utf8')).toBe('# custom\n');
  });

  it('skipEnable writes service without starting', async () => {
    const { installSystemdWatcher } = await import('./systemd.js');
    const result = await installSystemdWatcher({
      vaultPath: '/v',
      watcherBin: '/b',
      templatesDir,
      systemdUserDir,
      skipEnable: true,
    });

    expect(result.wroteService).toBe(true);
    expect(result.enabled).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('uninstall disables + removes the service file', async () => {
    await mkdir(systemdUserDir, { recursive: true });
    const servicePath = join(systemdUserDir, 'metalmind-vault-indexer.service');
    await writeFile(servicePath, '# exists', 'utf8');
    runCommand
      .mockResolvedValueOnce(ok()) // disable --now
      .mockResolvedValueOnce(ok()); // daemon-reload

    const { uninstallSystemdWatcher } = await import('./systemd.js');
    const result = await uninstallSystemdWatcher({ systemdUserDir });

    expect(result.disabled).toBe(true);
    expect(result.removedService).toBe(true);
    expect(existsSync(servicePath)).toBe(false);
  });

  it('uninstall is a no-op when service is absent', async () => {
    const { uninstallSystemdWatcher } = await import('./systemd.js');
    const result = await uninstallSystemdWatcher({ systemdUserDir });

    expect(result.disabled).toBe(false);
    expect(result.removedService).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
  });
});
