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

function mockOk(stdout = 'ok'): CommandResult {
  return { stdout, stderr: '', ok: true, exitCode: 0 };
}

function mockFail(stderr = 'fail'): CommandResult {
  return { stdout: '', stderr, ok: false, exitCode: 1 };
}

describe('launchd watcher', () => {
  let tmp: string;
  let templatesDir: string;
  let launchAgentsDir: string;

  const plistTemplate = `<?xml version="1.0"?>
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.claude.vault-indexer</string>
    <key>ProgramArguments</key>
    <array>
      <string>{{UV_PATH}}</string>
      <string>run</string>
      <string>--directory</string>
      <string>{{VAULT_PATH}}/.claude-stack/vault_rag</string>
    </array>
  </dict>
</plist>
`;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-launchd-'));
    templatesDir = join(tmp, 'templates');
    launchAgentsDir = join(tmp, 'LaunchAgents');
    await mkdir(join(templatesDir, 'launchd'), { recursive: true });
    await writeFile(
      join(templatesDir, 'launchd', 'com.claude.vault-indexer.plist.template'),
      plistTemplate,
      'utf8',
    );
    runCommand.mockReset();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('renders plist with vaultPath + uvPath substituted', async () => {
    runCommand.mockResolvedValueOnce(mockOk());
    const { installLaunchdWatcher } = await import('./launchd.js');

    const result = await installLaunchdWatcher({
      vaultPath: '/Users/me/Knowledge',
      uvPath: '/opt/homebrew/bin/uv',
      templatesDir,
      launchAgentsDir,
    });

    expect(result.wrotePlist).toBe(true);
    expect(result.loaded).toBe(true);
    const contents = await readFile(result.plistPath, 'utf8');
    expect(contents).toContain('<string>/opt/homebrew/bin/uv</string>');
    expect(contents).toContain('/Users/me/Knowledge/.claude-stack/vault_rag');
    expect(contents).not.toContain('{{');
  });

  it('preserves existing plist on re-install', async () => {
    await mkdir(launchAgentsDir, { recursive: true });
    const plistPath = join(launchAgentsDir, 'com.claude.vault-indexer.plist');
    await writeFile(plistPath, '<!-- custom -->\n', 'utf8');
    runCommand.mockResolvedValueOnce(mockOk());

    const { installLaunchdWatcher } = await import('./launchd.js');
    const result = await installLaunchdWatcher({
      vaultPath: '/v',
      uvPath: '/u',
      templatesDir,
      launchAgentsDir,
    });

    expect(result.wrotePlist).toBe(false);
    expect(await readFile(plistPath, 'utf8')).toBe('<!-- custom -->\n');
  });

  it('falls back to bootstrap when launchctl load fails', async () => {
    runCommand.mockResolvedValueOnce(mockFail('already loaded')).mockResolvedValueOnce(mockOk());

    const { installLaunchdWatcher } = await import('./launchd.js');
    const result = await installLaunchdWatcher({
      vaultPath: '/v',
      uvPath: '/u',
      templatesDir,
      launchAgentsDir,
    });

    expect(result.loaded).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand.mock.calls[0]?.[1]?.[0]).toBe('load');
    expect(runCommand.mock.calls[1]?.[1]?.[0]).toBe('bootstrap');
  });

  it('skipLoad renders plist without loading', async () => {
    const { installLaunchdWatcher } = await import('./launchd.js');
    const result = await installLaunchdWatcher({
      vaultPath: '/v',
      uvPath: '/u',
      templatesDir,
      launchAgentsDir,
      skipLoad: true,
    });

    expect(result.wrotePlist).toBe(true);
    expect(result.loaded).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('unload + delete reverses install cleanly', async () => {
    await mkdir(launchAgentsDir, { recursive: true });
    const plistPath = join(launchAgentsDir, 'com.claude.vault-indexer.plist');
    await writeFile(plistPath, '<!-- exists -->', 'utf8');
    runCommand.mockResolvedValueOnce(mockOk());

    const { uninstallLaunchdWatcher } = await import('./launchd.js');
    const result = await uninstallLaunchdWatcher({ launchAgentsDir });

    expect(result.unloaded).toBe(true);
    expect(result.removedPlist).toBe(true);
    expect(existsSync(plistPath)).toBe(false);
  });

  it('uninstall is a no-op when plist is absent', async () => {
    const { uninstallLaunchdWatcher } = await import('./launchd.js');
    const result = await uninstallLaunchdWatcher({ launchAgentsDir });

    expect(result.unloaded).toBe(false);
    expect(result.removedPlist).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('renderPlist throws on unbound variable', async () => {
    await writeFile(
      join(templatesDir, 'launchd', 'com.claude.vault-indexer.plist.template'),
      '{{UNKNOWN_VAR}}',
      'utf8',
    );
    const { installLaunchdWatcher } = await import('./launchd.js');
    await expect(
      installLaunchdWatcher({
        vaultPath: '/v',
        uvPath: '/u',
        templatesDir,
        launchAgentsDir,
        skipLoad: true,
      }),
    ).rejects.toThrow(/Unbound plist variable/);
  });
});
