import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../util/exec.js';

const runCommand = vi.hoisted(() =>
  vi.fn<
    (
      cmd: string,
      args?: string[],
      opts?: { timeoutMs?: number; cwd?: string },
    ) => Promise<CommandResult>
  >(),
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
    // cwd must be a throwaway temp dir, NOT $HOME — graphify stamps a
    // CLAUDE.md in cwd, and we don't want that file at $HOME polluting
    // every Claude Code session in any subfolder of home.
    const claudeInstallOpts = runCommand.mock.calls[3]?.[2] as { cwd?: string } | undefined;
    expect(claudeInstallOpts?.cwd).toBeTruthy();
    expect(claudeInstallOpts?.cwd).not.toBe('/');
    expect(claudeInstallOpts?.cwd).not.toBe(process.env.HOME);
    expect(claudeInstallOpts?.cwd).toMatch(/metalmind-graphify-/);
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

  describe('cleanLegacyHomeClaudeMdStamp', () => {
    let tmp: string;

    beforeEach(async () => {
      tmp = await mkdtemp(join(tmpdir(), 'metalmind-cleanup-'));
    });

    afterEach(async () => {
      await rm(tmp, { recursive: true, force: true });
    });

    it('returns false when ~/CLAUDE.md does not exist', async () => {
      const { cleanLegacyHomeClaudeMdStamp } = await import('./graphify.js');
      const removed = await cleanLegacyHomeClaudeMdStamp(tmp);
      expect(removed).toBe(false);
    });

    it('returns false when file exists but has no graphify section', async () => {
      await writeFile(join(tmp, 'CLAUDE.md'), '# my notes\nrandom content\n', 'utf8');
      const { cleanLegacyHomeClaudeMdStamp } = await import('./graphify.js');
      const removed = await cleanLegacyHomeClaudeMdStamp(tmp);
      expect(removed).toBe(false);
      const after = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
      expect(after).toContain('# my notes');
    });

    it('deletes the file when it only contains the graphify section', async () => {
      await writeFile(
        join(tmp, 'CLAUDE.md'),
        '## graphify\n\nThis project has a graphify knowledge graph at graphify-out/.\n',
        'utf8',
      );
      const { cleanLegacyHomeClaudeMdStamp } = await import('./graphify.js');
      const removed = await cleanLegacyHomeClaudeMdStamp(tmp);
      expect(removed).toBe(true);
      expect(existsSync(join(tmp, 'CLAUDE.md'))).toBe(false);
    });

    it('strips only the graphify section, preserves other user content', async () => {
      await writeFile(
        join(tmp, 'CLAUDE.md'),
        '# My personal notes\n\nKept text\n\n## graphify\n\nThis project has a graphify knowledge graph at graphify-out/.\n\n## Another section\n\nAlso kept\n',
        'utf8',
      );
      const { cleanLegacyHomeClaudeMdStamp } = await import('./graphify.js');
      const removed = await cleanLegacyHomeClaudeMdStamp(tmp);
      expect(removed).toBe(true);
      const after = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
      expect(after).toContain('# My personal notes');
      expect(after).toContain('Kept text');
      expect(after).toContain('## Another section');
      expect(after).toContain('Also kept');
      expect(after).not.toContain('graphify');
    });
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
