import { existsSync } from 'node:fs';
import { rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_PATH, type Config, readConfig } from '../config.js';
import { removeSentinelBlock, type SentinelRemoveAction } from '../util/sentinel.js';
import { uninstallAliases } from './aliases.js';
import { uninstallGraphify } from './graphify.js';
import { unregisterMcpServers } from './mcp.js';
import { uninstallOutputStyle } from './output-style.js';
import { uninstallSerena } from './serena.js';
import { clearMemoryRouting, clearMetalmindSessionStartHook } from './settings.js';
import { STACK_SUBDIR, stopStack } from './stack.js';
import { METALMIND_HOOK_FILENAME } from './templates.js';
import { uninstallVaultRag } from './vault-rag.js';
import type { WatcherPlatform } from './watcher.js';
import { uninstallWatcher } from './watcher.js';

export interface TeardownOptions {
  /**
   * REQUIRED. Directory the teardown operates on — typically `~/.claude` in
   * production, a tmp dir in tests. We do NOT default to the real home dir:
   * silently stomping a user's `~/.claude/CLAUDE.md` from a test run is the
   * kind of bug that costs a day to find. Callers (the uninstall command,
   * tests) must opt in explicitly.
   */
  claudeDir: string;
  /**
   * REQUIRED. Path to the Claude Code settings.json the teardown may mutate.
   * Same reasoning as `claudeDir` — no silent fallback to the real user file.
   */
  settingsPath: string;
  config?: Config;
  removeSerena?: boolean;
  removeGraphify?: boolean;
  removeVolumes?: boolean;
  launchAgentsDir?: string;
  claudeJsonPath?: string;
  aliasesPath?: string;
  zshrcPath?: string;
  configPath?: string;
  removeVaultRag?: boolean;
  /** Force the watcher-uninstall path in tests so the same expectations hold
   *  on macOS + Linux CI. Production callers leave this undefined. */
  platformOverride?: WatcherPlatform;
}

export interface TeardownResult {
  watcher: { removedPlist: boolean; unloaded: boolean };
  stackStopped: boolean;
  stackRemoved: boolean;
  serenaUninstalled: boolean;
  graphifyUninstalled: boolean;
  mcp: { removed: string[]; notPresent: string[] };
  aliases: { removedAliases: boolean; removedSourceLine: boolean };
  outputStyle: { styleRemoved: boolean; settingsRestored: boolean };
  configRemoved: boolean;
  vaultRagUninstalled: boolean;
  memoryRoutingCleared: boolean;
  sessionStartHook: { registrationCleared: boolean; scriptRemoved: boolean };
  claudeMdBlocks: { global: SentinelRemoveAction; vault: SentinelRemoveAction };
}

export async function teardown(opts: TeardownOptions): Promise<TeardownResult> {
  const configPath = opts.configPath ?? CONFIG_PATH;
  const config = opts.config ?? (await readConfig(configPath));

  const result: TeardownResult = {
    watcher: { removedPlist: false, unloaded: false },
    stackStopped: false,
    stackRemoved: false,
    serenaUninstalled: false,
    graphifyUninstalled: false,
    mcp: { removed: [], notPresent: [] },
    aliases: { removedAliases: false, removedSourceLine: false },
    outputStyle: { styleRemoved: false, settingsRestored: false },
    configRemoved: false,
    vaultRagUninstalled: false,
    memoryRoutingCleared: false,
    sessionStartHook: { registrationCleared: false, scriptRemoved: false },
    claudeMdBlocks: { global: 'no-file', vault: 'no-file' },
  };

  const watcher = await uninstallWatcher({
    launchAgentsDir: opts.launchAgentsDir,
    platformOverride: opts.platformOverride,
  });
  result.watcher = { removedPlist: watcher.removedUnit, unloaded: watcher.stopped };

  if (config?.vaultPath) {
    const stackDir = join(config.vaultPath, STACK_SUBDIR);
    if (existsSync(join(stackDir, 'compose.yml'))) {
      try {
        await stopStack(stackDir, { removeVolumes: opts.removeVolumes });
        result.stackStopped = true;
      } catch {
        // docker may not be running; continue teardown
      }
    }
    if (existsSync(stackDir)) {
      await rm(stackDir, { recursive: true, force: true });
      result.stackRemoved = true;
    }
  }

  if (opts.removeSerena) {
    const { uninstalled } = await uninstallSerena();
    result.serenaUninstalled = uninstalled;
  }

  if (opts.removeGraphify) {
    const { uninstalled } = await uninstallGraphify();
    result.graphifyUninstalled = uninstalled;
  }

  if (opts.removeVaultRag) {
    const { uninstalled } = await uninstallVaultRag();
    result.vaultRagUninstalled = uninstalled;
  }

  const { claudeDir, settingsPath } = opts;

  result.memoryRoutingCleared = await clearMemoryRouting(settingsPath);
  result.sessionStartHook.registrationCleared = await clearMetalmindSessionStartHook(settingsPath);
  const hookScriptPath = join(claudeDir, 'hooks', METALMIND_HOOK_FILENAME);
  if (existsSync(hookScriptPath)) {
    await rm(hookScriptPath, { force: true });
    result.sessionStartHook.scriptRemoved = true;
  }

  const mcp = await unregisterMcpServers({
    servers: ['vault-rag', 'serena'],
    claudeJsonPath: opts.claudeJsonPath,
    clearTeammateMode: true,
  });
  result.mcp = { removed: mcp.removed, notPresent: mcp.notPresent };

  const aliases = await uninstallAliases({
    aliasesPath: opts.aliasesPath,
    zshrcPath: opts.zshrcPath,
  });
  result.aliases = aliases;

  if (config?.outputStyle.installed) {
    const style = await uninstallOutputStyle({
      styleName: config.outputStyle.installed,
      priorValue: config.outputStyle.priorValue,
    });
    result.outputStyle = style;
  }

  const globalClaudeMd = join(claudeDir, 'CLAUDE.md');
  const vaultClaudeMd = config?.vaultPath ? join(config.vaultPath, 'CLAUDE.md') : null;

  result.claudeMdBlocks.global = (await removeSentinelBlock({ path: globalClaudeMd })).action;
  if (vaultClaudeMd) {
    result.claudeMdBlocks.vault = (
      await removeSentinelBlock({ path: vaultClaudeMd, deleteIfEmpty: true })
    ).action;
  }

  if (existsSync(configPath)) {
    await unlink(configPath);
    result.configRemoved = true;
  }

  return result;
}
