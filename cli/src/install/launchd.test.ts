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
    <key>Label</key><string>com.metalmind.vault-indexer</string>
    <key>ProgramArguments</key>
    <array>
      <string>{{WATCHER_BIN}}</string>
      <string>PATH={{PATH_VALUE}}</string>
      <string>{{VAULT_PATH}}/.metalmind-stack</string>
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
      join(templatesDir, 'launchd', 'com.metalmind.vault-indexer.plist.template'),
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
      watcherBin: '/opt/homebrew/bin/metalmind-vault-rag-watcher',
      uvBin: '/opt/homebrew/bin/uv',
      templatesDir,
      launchAgentsDir,
    });

    expect(result.wrotePlist).toBe(true);
    expect(result.loaded).toBe(true);
    const contents = await readFile(result.plistPath, 'utf8');
    expect(contents).toContain('<string>/opt/homebrew/bin/metalmind-vault-rag-watcher</string>');
    expect(contents).toContain('/Users/me/Knowledge/.metalmind-stack');
    expect(contents).not.toContain('{{');
  });

  it('overwrites stale plist on re-install, unloading first so the new config is picked up', async () => {
    await mkdir(launchAgentsDir, { recursive: true });
    const plistPath = join(launchAgentsDir, 'com.metalmind.vault-indexer.plist');
    await writeFile(plistPath, '<!-- stale -->\n', 'utf8');
    runCommand
      .mockResolvedValueOnce(mockOk()) // launchctl unload (prior cleanup)
      .mockResolvedValueOnce(mockOk()); // launchctl load (new)

    const { installLaunchdWatcher } = await import('./launchd.js');
    const result = await installLaunchdWatcher({
      vaultPath: '/v',
      watcherBin: '/u/metalmind-vault-rag-watcher',
      uvBin: '/opt/homebrew/bin/uv',
      templatesDir,
      launchAgentsDir,
    });

    expect(result.wrotePlist).toBe(true);
    const contents = await readFile(plistPath, 'utf8');
    expect(contents).not.toBe('<!-- stale -->\n');
    expect(contents).toContain('/u/metalmind-vault-rag-watcher');
    expect(runCommand.mock.calls[0]?.[1]?.[0]).toBe('unload');
    expect(runCommand.mock.calls[1]?.[1]?.[0]).toBe('load');
  });

  it('reports wrotePlist=false when the rendered template matches the existing plist', async () => {
    await mkdir(launchAgentsDir, { recursive: true });
    const plistPath = join(launchAgentsDir, 'com.metalmind.vault-indexer.plist');
    // Render the template ourselves and write it — matches what installer would render.
    const identical = plistTemplate
      .replace(/\{\{WATCHER_BIN\}\}/g, '/u/w')
      .replace(/\{\{PATH_VALUE\}\}/g, process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin')
      .replace(/\{\{VAULT_PATH\}\}/g, '/v');
    await writeFile(plistPath, identical, 'utf8');
    runCommand.mockResolvedValueOnce(mockOk());

    const { installLaunchdWatcher } = await import('./launchd.js');
    const result = await installLaunchdWatcher({
      vaultPath: '/v',
      watcherBin: '/u/w',
      uvBin: '/opt/homebrew/bin/uv',
      templatesDir,
      launchAgentsDir,
    });

    expect(result.wrotePlist).toBe(false);
    // No unload call when content is unchanged — only the load at the end.
    expect(runCommand.mock.calls[0]?.[1]?.[0]).toBe('load');
  });

  it('falls back to bootstrap when launchctl load fails', async () => {
    runCommand.mockResolvedValueOnce(mockFail('already loaded')).mockResolvedValueOnce(mockOk());

    const { installLaunchdWatcher } = await import('./launchd.js');
    const result = await installLaunchdWatcher({
      vaultPath: '/v',
      watcherBin: '/u/metalmind-vault-rag-watcher',
      uvBin: '/opt/homebrew/bin/uv',
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
      watcherBin: '/u/metalmind-vault-rag-watcher',
      uvBin: '/opt/homebrew/bin/uv',
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
    const plistPath = join(launchAgentsDir, 'com.metalmind.vault-indexer.plist');
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
      join(templatesDir, 'launchd', 'com.metalmind.vault-indexer.plist.template'),
      '{{UNKNOWN_VAR}}',
      'utf8',
    );
    const { installLaunchdWatcher } = await import('./launchd.js');
    await expect(
      installLaunchdWatcher({
        vaultPath: '/v',
        watcherBin: '/u/metalmind-vault-rag-watcher',
      uvBin: '/opt/homebrew/bin/uv',
        templatesDir,
        launchAgentsDir,
        skipLoad: true,
      }),
    ).rejects.toThrow(/Unbound plist variable/);
  });
});
