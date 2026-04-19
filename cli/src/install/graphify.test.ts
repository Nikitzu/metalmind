import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('graphify install', () => {
  beforeEach(() => {
    runCommand.mockReset();
  });

  it('runs uv tool install + graphify claude install when missing', async () => {
    runCommand
      .mockResolvedValueOnce(fail('command not found')) // graphify --version (pre-install)
      .mockResolvedValueOnce(ok()) // uv tool install graphifyy
      .mockResolvedValueOnce(ok('graphify 0.9.0')) // graphify --version (post-install version probe)
      .mockResolvedValueOnce(ok()); // graphify claude install

    const { installGraphify } = await import('./graphify.js');
    const result = await installGraphify();

    expect(result.installed).toBe(true);
    expect(result.alreadyInstalled).toBe(false);
    expect(result.claudeWired).toBe(true);
    expect(runCommand.mock.calls[1]?.[0]).toBe('uv');
    expect(runCommand.mock.calls[1]?.[1]).toEqual(['tool', 'install', 'graphifyy']);
    expect(runCommand.mock.calls[3]?.[0]).toBe('graphify');
    expect(runCommand.mock.calls[3]?.[1]).toEqual(['claude', 'install']);
  });

  it('skips uv tool install when graphify already on PATH', async () => {
    runCommand
      .mockResolvedValueOnce(ok('graphify 0.9.0')) // pre-install version probe — already present
      .mockResolvedValueOnce(ok()); // graphify claude install

    const { installGraphify } = await import('./graphify.js');
    const result = await installGraphify();

    expect(result.alreadyInstalled).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.claudeWired).toBe(true);
  });

  it('rejects an outdated graphify with a remediation hint', async () => {
    runCommand.mockResolvedValueOnce(ok('graphify 0.1.0')); // too old

    const { installGraphify } = await import('./graphify.js');
    await expect(installGraphify()).rejects.toThrow(/too old \(need 0\.9\.0\+\)/);
  });

  it('surfaces uv tool install failure', async () => {
    runCommand.mockResolvedValueOnce(fail('not found')).mockResolvedValueOnce(fail('pypi 404'));

    const { installGraphify } = await import('./graphify.js');
    await expect(installGraphify()).rejects.toThrow(/uv tool install graphifyy/);
  });

  it('surfaces graphify claude install failure', async () => {
    runCommand
      .mockResolvedValueOnce(ok('graphify 0.9.0')) // pre-install version (ok, on PATH)
      .mockResolvedValueOnce(fail('claude.json unreachable')); // graphify claude install

    const { installGraphify } = await import('./graphify.js');
    await expect(installGraphify()).rejects.toThrow(/graphify claude install/);
  });

  it('skipClaudeWire runs only the tool install step', async () => {
    runCommand.mockResolvedValueOnce(fail('not found')).mockResolvedValueOnce(ok());

    const { installGraphify } = await import('./graphify.js');
    const result = await installGraphify({ skipClaudeWire: true });

    expect(result.installed).toBe(true);
    expect(result.claudeWired).toBe(false);
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it('uninstall runs graphify claude uninstall then uv tool uninstall', async () => {
    runCommand
      .mockResolvedValueOnce(ok('graphify 0.9.0')) // version probe
      .mockResolvedValueOnce(ok()) // graphify claude uninstall
      .mockResolvedValueOnce(ok()); // uv tool uninstall

    const { uninstallGraphify } = await import('./graphify.js');
    const result = await uninstallGraphify();

    expect(result.claudeUnwired).toBe(true);
    expect(result.uninstalled).toBe(true);
  });

  it('uninstall skips claude step when graphify absent', async () => {
    runCommand.mockResolvedValueOnce(fail('not found')).mockResolvedValueOnce(ok());

    const { uninstallGraphify } = await import('./graphify.js');
    const result = await uninstallGraphify();
    expect(result.claudeUnwired).toBe(false);
    expect(result.uninstalled).toBe(true);
  });
});
