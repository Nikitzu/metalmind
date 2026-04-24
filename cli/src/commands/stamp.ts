import { intro, log, outro } from '@clack/prompts';
import { readConfig } from '../config.js';
import { installAliases } from '../install/aliases.js';
import { applyMemoryRouting, applyMetalmindSessionStartHook } from '../install/settings.js';
import { copyClaudeHooks, copyClaudeTemplates, stampClaudeMd } from '../install/templates.js';
import { setupVault } from '../install/vault.js';
import { resolveUvBinPath, resolveWatcherBinPath } from '../install/vault-rag.js';
import { installWatcher } from '../install/watcher.js';

export interface StampOptions {
  skipWatcher?: boolean;
}

export async function stamp(opts: StampOptions = {}): Promise<void> {
  intro('metalmind stamp');

  const config = await readConfig();
  if (!config) {
    log.error('No ~/.metalmind/config.json — run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }

  log.step('Vault CLAUDE.md');
  const vault = await setupVault({ vaultPath: config.vaultPath, flavor: config.flavor });
  log.info(`  ${vault.claudeMdAction}`);

  log.step('Global CLAUDE.md block + rules/agents/commands');
  const tpl = await copyClaudeTemplates({
    flavor: config.flavor,
    eodHook: config.skills.eodHook,
    notifications: config.skills.notifications,
  });
  log.info(`  ${tpl.copied.length} files refreshed`);
  const claudeMd = await stampClaudeMd({
    vaultPath: config.vaultPath,
    flavor: config.flavor,
  });
  log.info(`  ~/.claude/CLAUDE.md block: ${claudeMd.blockAction}`);

  log.step('Shell aliases');
  const aliases = await installAliases();
  log.info(`  aliases.sh written; sourced in ${aliases.appendedTo.length} shell rc file(s)`);

  log.step('Memory routing');
  const mem = await applyMemoryRouting({
    disableNative: config.memoryRouting === 'vault-only',
  });
  log.info(mem.changed ? '  settings.json env updated' : '  settings.json already correct');

  log.step('SessionStart hook');
  const hookScript = await copyClaudeHooks({ flavor: config.flavor });
  const hookReg = await applyMetalmindSessionStartHook({ hookCommand: hookScript.hookCommand });
  log.info(`  script: ${hookScript.action}`);
  log.info(hookReg.changed ? '  settings.json: registered' : '  settings.json: already registered');

  if (!opts.skipWatcher) {
    log.step('Watcher unit file');
    try {
      const watcherBin = await resolveWatcherBinPath();
      const uvBin = await resolveUvBinPath();
      const watcher = await installWatcher({ vaultPath: config.vaultPath, watcherBin, uvBin });
      log.info(
        watcher.wroteUnit
          ? `  refreshed ${watcher.unitPath} (service restarted)`
          : `  ${watcher.unitPath} already current`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`  skipped: ${message}`);
    }
  }

  outro('Stamp complete. Run `metalmind pulse` to verify.');
}
