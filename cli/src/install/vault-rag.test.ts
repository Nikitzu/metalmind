import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../util/exec.js';

const runCommand = vi.hoisted(() =>
  vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<CommandResult>>(),
);

vi.mock('../util/exec.js', () => ({
  runCommand,
}));

function mockResult(partial: Partial<CommandResult>): CommandResult {
  return { stdout: '', stderr: '', ok: true, exitCode: 0, ...partial };
}

describe('installVaultRag (isVaultRagInstalled via uv tool list)', () => {
  beforeEach(() => {
    runCommand.mockReset();
  });

  it('skips install when uv tool list already contains the package', async () => {
    runCommand.mockResolvedValueOnce(
      mockResult({
        stdout: 'graphify v0.4.0\nmetalmind-vault-rag v0.1.0\n- server\n- watcher\nserena v0.1.4\n',
      }),
    );
    const { installVaultRag } = await import('./vault-rag.js');
    const r = await installVaultRag({ templatesDir: '/tmp/x' });
    expect(r.alreadyInstalled).toBe(true);
    expect(r.installed).toBe(false);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('uv', ['tool', 'list'], expect.any(Object));
  });

  it('installs when the package is absent from uv tool list', async () => {
    runCommand
      .mockResolvedValueOnce(mockResult({ stdout: 'graphify v0.4.0\nserena v0.1.4\n' }))
      .mockResolvedValueOnce(mockResult({ stdout: 'Installed', ok: true }));
    const { installVaultRag } = await import('./vault-rag.js');
    const r = await installVaultRag({ templatesDir: '/tmp/pkg' });
    expect(r.alreadyInstalled).toBe(false);
    expect(r.installed).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(2);
    const secondCall = runCommand.mock.calls[1];
    expect(secondCall?.[0]).toBe('uv');
    expect(secondCall?.[1]).toEqual(
      expect.arrayContaining([
        'tool',
        'install',
        '--from',
        '/tmp/pkg/vault-rag-pkg',
        'metalmind-vault-rag',
      ]),
    );
  });

  it('does not match on substring — requires start-of-line package name', async () => {
    runCommand
      .mockResolvedValueOnce(
        mockResult({ stdout: 'other-tool v1 (provides metalmind-vault-rag-helper)\n' }),
      )
      .mockResolvedValueOnce(mockResult({ stdout: 'Installed', ok: true }));
    const { installVaultRag } = await import('./vault-rag.js');
    const r = await installVaultRag({ templatesDir: '/tmp/pkg' });
    expect(r.alreadyInstalled).toBe(false);
    expect(r.installed).toBe(true);
  });

  it('treats failing uv tool list as not installed and proceeds to install', async () => {
    runCommand
      .mockResolvedValueOnce(mockResult({ ok: false, exitCode: 1, stderr: 'uv not found' }))
      .mockResolvedValueOnce(mockResult({ stdout: 'Installed', ok: true }));
    const { installVaultRag } = await import('./vault-rag.js');
    const r = await installVaultRag({ templatesDir: '/tmp/pkg' });
    expect(r.alreadyInstalled).toBe(false);
    expect(r.installed).toBe(true);
  });

  it('forces reinstall when reinstall=true, bypassing the uv tool list check', async () => {
    runCommand.mockResolvedValueOnce(mockResult({ stdout: 'Installed', ok: true }));
    const { installVaultRag } = await import('./vault-rag.js');
    const r = await installVaultRag({ templatesDir: '/tmp/pkg', reinstall: true });
    expect(r.installed).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(1);
    const call = runCommand.mock.calls[0];
    expect(call?.[1]).toEqual(expect.arrayContaining(['--reinstall', '--force']));
  });

  it('throws when uv tool install fails', async () => {
    runCommand
      .mockResolvedValueOnce(mockResult({ stdout: '' }))
      .mockResolvedValueOnce(mockResult({ ok: false, exitCode: 1, stderr: 'boom' }));
    const { installVaultRag } = await import('./vault-rag.js');
    await expect(installVaultRag({ templatesDir: '/tmp/pkg' })).rejects.toThrow(/uv tool install/);
  });
});
