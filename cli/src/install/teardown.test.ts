import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
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

function baseConfig(vaultPath: string): Config {
  return {
    version: 5,
    flavor: 'scadrial',
    vaultPath,
    outputStylePriorValue: null,
    embeddings: { provider: 'local', baseURL: null },
    recall: { defaultTier: 'fast', httpEndpoint: null },
    verbose: false,
    mcp: { registered: ['vault-rag'] },
    hooks: { claudeCode: false },
    forge: { groups: {} },
    memoryRouting: 'vault-only',
    skills: { eodHook: true, notifications: true },
    hosts: ['claude'],
    install: { profile: 'full', teams: false },
  };
}

describe('teardown', () => {
  let tmp: string;
  let vaultPath: string;
  let stackDir: string;
  let plistPath: string;
  let launchAgentsDir: string;
  let claudeJsonPath: string;
  let aliasesPath: string;
  let zshrcPath: string;
  let configPath: string;
  let claudeDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-teardown-'));
    vaultPath = join(tmp, 'vault');
    stackDir = join(vaultPath, '.metalmind-stack');
    await mkdir(stackDir, { recursive: true });
    await writeFile(join(stackDir, 'compose.yml'), 'services: {}\n', 'utf8');

    launchAgentsDir = join(tmp, 'LaunchAgents');
    await mkdir(launchAgentsDir, { recursive: true });
    plistPath = join(launchAgentsDir, 'com.metalmind.vault-indexer.plist');
    await writeFile(plistPath, '<!-- plist -->\n', 'utf8');

    claudeDir = join(tmp, 'claude');
    await mkdir(claudeDir, { recursive: true });
    settingsPath = join(claudeDir, 'settings.json');
    await writeFile(settingsPath, '{}', 'utf8');

    claudeJsonPath = join(tmp, '.claude.json');
    await writeFile(
      claudeJsonPath,
      JSON.stringify({
        mcpServers: {
          'vault-rag': { command: 'uv' },
          serena: { command: 'serena' },
          'other-server': { command: 'custom' },
        },
      }),
      'utf8',
    );

    aliasesPath = join(tmp, '.metalmind', 'aliases.sh');
    await mkdir(join(tmp, '.metalmind'), { recursive: true });
    await writeFile(aliasesPath, '# aliases\n', 'utf8');
    zshrcPath = join(tmp, '.zshrc');
    await writeFile(zshrcPath, '# user zshrc\n# metalmind aliases\n[ -f x ] && source x\n', 'utf8');

    configPath = join(tmp, '.metalmind', 'config.json');
    await writeFile(configPath, JSON.stringify(baseConfig(vaultPath)), 'utf8');

    runCommand.mockReset();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('reverses install end-to-end with stack running', async () => {
    runCommand
      .mockResolvedValueOnce(ok()) // launchctl unload
      .mockResolvedValueOnce(ok()); // docker compose down

    const { teardown } = await import('./teardown.js');
    const result = await teardown({
      config: baseConfig(vaultPath),
      launchAgentsDir,
      claudeJsonPath,
      aliasesPath,
      zshrcPath,
      claudeDir,
      platformOverride: 'darwin',
      settingsPath,
      configPath,
    });

    expect(result.watcher.removedPlist).toBe(true);
    expect(result.stackStopped).toBe(true);
    expect(result.stackRemoved).toBe(true);
    expect(result.mcp.removed).toEqual(['vault-rag', 'serena']);
    expect(result.aliases.removedAliases).toBe(true);
    expect(result.aliases.removedSourceLine).toBe(true);
    expect(result.configRemoved).toBe(true);

    expect(existsSync(plistPath)).toBe(false);
    expect(existsSync(stackDir)).toBe(false);
    expect(existsSync(aliasesPath)).toBe(false);
    expect(existsSync(configPath)).toBe(false);
  });

  it('continues when docker compose down fails (daemon not running)', async () => {
    runCommand
      .mockResolvedValueOnce(ok()) // launchctl unload
      .mockResolvedValueOnce(fail('Cannot connect to docker daemon'));

    const { teardown } = await import('./teardown.js');
    const result = await teardown({
      config: baseConfig(vaultPath),
      launchAgentsDir,
      claudeJsonPath,
      aliasesPath,
      zshrcPath,
      claudeDir,
      platformOverride: 'darwin',
      settingsPath,
      configPath,
    });

    expect(result.stackStopped).toBe(false);
    expect(result.stackRemoved).toBe(true);
    expect(result.configRemoved).toBe(true);
  });

  it('sweeps the retired output style only inside the given claudeDir', async () => {
    runCommand.mockResolvedValue(ok());

    // Regression guard: cleanupOutputStyle defaults every directory to the real
    // ~/.claude. teardown must override all of them, or running this suite
    // deletes the developer's own styles and skills.
    await mkdir(join(claudeDir, 'output-styles'), { recursive: true });
    await mkdir(join(claudeDir, 'skills', 'marsh'), { recursive: true });
    await writeFile(join(claudeDir, 'output-styles', 'marsh.md'), '# marsh', 'utf8');
    await writeFile(join(claudeDir, 'skills', 'marsh', 'SKILL.md'), '# skill', 'utf8');

    const homeStyles = join(homedir(), '.claude', 'output-styles');
    const homeSkills = join(homedir(), '.claude', 'skills');

    const { teardown } = await import('./teardown.js');
    const result = await teardown({
      config: baseConfig(vaultPath),
      launchAgentsDir,
      claudeJsonPath,
      aliasesPath,
      zshrcPath,
      claudeDir,
      platformOverride: 'darwin',
      settingsPath,
      configPath,
    });

    expect(result.outputStyle.stylesRemoved).toEqual(['marsh']);
    expect(result.outputStyle.skillsRemoved).toEqual(['marsh']);
    expect(existsSync(join(claudeDir, 'output-styles', 'marsh.md'))).toBe(false);
    expect(existsSync(join(claudeDir, 'skills', 'marsh'))).toBe(false);

    // Nothing the sweep touched may resolve outside the sandbox.
    expect(join(claudeDir, 'output-styles')).not.toBe(homeStyles);
    expect(join(claudeDir, 'skills')).not.toBe(homeSkills);
  });

  it('preserves other MCP servers in ~/.claude.json', async () => {
    runCommand.mockResolvedValue(ok());

    const { teardown } = await import('./teardown.js');
    await teardown({
      config: baseConfig(vaultPath),
      launchAgentsDir,
      claudeJsonPath,
      aliasesPath,
      zshrcPath,
      claudeDir,
      platformOverride: 'darwin',
      settingsPath,
      configPath,
    });

    const raw = await (await import('node:fs/promises')).readFile(claudeJsonPath, 'utf8');
    const data = JSON.parse(raw);
    expect(data.mcpServers['other-server']).toBeDefined();
    expect(data.mcpServers['vault-rag']).toBeUndefined();
  });

  it('runs uv tool uninstall when removeSerena=true', async () => {
    runCommand
      .mockResolvedValueOnce(ok()) // launchctl unload
      .mockResolvedValueOnce(ok()) // docker down
      .mockResolvedValueOnce(ok('serena 0.1.0')) // serena --version
      .mockResolvedValueOnce(ok()); // uv tool uninstall

    const { teardown } = await import('./teardown.js');
    const result = await teardown({
      config: baseConfig(vaultPath),
      removeSerena: true,
      launchAgentsDir,
      claudeJsonPath,
      aliasesPath,
      zshrcPath,
      claudeDir,
      platformOverride: 'darwin',
      settingsPath,
      configPath,
    });

    expect(result.serenaUninstalled).toBe(true);
  });

  it('operates best-effort when config missing (no vault ops)', async () => {
    runCommand.mockResolvedValueOnce(ok()); // launchctl unload

    const { teardown } = await import('./teardown.js');
    const result = await teardown({
      config: undefined,
      launchAgentsDir,
      claudeJsonPath,
      aliasesPath,
      zshrcPath,
      claudeDir,
      platformOverride: 'darwin',
      settingsPath,
      configPath: join(tmp, 'missing.json'),
    });

    expect(result.stackStopped).toBe(false);
    expect(result.stackRemoved).toBe(false);
    expect(result.mcp.removed).toEqual(['vault-rag', 'serena']);
    expect(result.configRemoved).toBe(false);
  });
});
