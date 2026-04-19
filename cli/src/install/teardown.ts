import { existsSync } from 'node:fs';
import { rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_PATH, type Config, readConfig } from '../config.js';
import { uninstallAliases } from './aliases.js';
import { uninstallGraphify } from './graphify.js';
import { uninstallLaunchdWatcher } from './launchd.js';
import { unregisterMcpServers } from './mcp.js';
import { uninstallOutputStyle } from './output-style.js';
import { uninstallSerena } from './serena.js';
import { clearMemoryRouting } from './settings.js';
import { STACK_SUBDIR, stopStack } from './stack.js';
import { uninstallVaultRag } from './vault-rag.js';

export interface TeardownOptions {
  config?: Config;
  removeSerena?: boolean;
  removeGraphify?: boolean;
  removeVolumes?: boolean;
  launchAgentsDir?: string;
  claudeJsonPath?: string;
  aliasesPath?: string;
  zshrcPath?: string;
  configPath?: string;
  settingsPath?: string;
  removeVaultRag?: boolean;
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
}

export async function teardown(opts: TeardownOptions = {}): Promise<TeardownResult> {
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
  };

  const watcher = await uninstallLaunchdWatcher({ launchAgentsDir: opts.launchAgentsDir });
  result.watcher = { removedPlist: watcher.removedPlist, unloaded: watcher.unloaded };

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

  result.memoryRoutingCleared = await clearMemoryRouting(opts.settingsPath);

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

  if (existsSync(configPath)) {
    await unlink(configPath);
    result.configRemoved = true;
  }

  return result;
}
