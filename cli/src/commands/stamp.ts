import { cancel, intro, log, outro } from '@clack/prompts';
import { type MetalmindHost, readConfig, writeConfig } from '../config.js';
import { installAliases } from '../install/aliases.js';
import { installCodex } from '../install/codex.js';
import { promptHosts } from '../install/host-prompt.js';
import { migrateTerseToTelegraph } from '../install/output-style.js';
import {
  applyMemoryRouting,
  applyMetalmindSessionStartHook,
  applyOutputStyleSessionStartHook,
  applyOutputStyleUserPromptSubmitHook,
} from '../install/settings.js';
import { copyClaudeHooks, copyClaudeTemplates, stampClaudeMd } from '../install/templates.js';
import { setupVault } from '../install/vault.js';
import {
  hasRerankExtraInstalled,
  installVaultRag,
  resolveUvBinPath,
  resolveWatcherBinPath,
} from '../install/vault-rag.js';
import { installWatcher } from '../install/watcher.js';

export interface StampOptions {
  skipWatcher?: boolean;
  /** Force the host set; bypasses the multi-select prompt. */
  hosts?: MetalmindHost[];
  /** Skip the multi-select; use the previously-chosen set. For CI / scripted re-stamps. */
  noPrompt?: boolean;
  /** Opt-in MCP registration for Codex. Off by default. */
  withMcp?: boolean;
}

export async function stamp(opts: StampOptions = {}): Promise<void> {
  intro('metalmind stamp');

  const config = await readConfig();
  if (!config) {
    log.error('No ~/.metalmind/config.json — run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }

  // Always re-prompt by default so newly-installed hosts (e.g. user installed
  // Codex after a CC-only stamp) surface for opt-in. --no-prompt skips and
  // re-uses config.hosts; --host claude|codex|both bypasses with explicit set.
  log.step('Choosing hosts');
  const hostsResult = await promptHosts({
    forced: opts.hosts,
    noPrompt: opts.noPrompt,
    preChecked: config.hosts,
  });
  if (hostsResult.cancelled) {
    cancel('Cancelled.');
    process.exitCode = 1;
    return;
  }
  const chosenHosts = hostsResult.hosts;
  if (chosenHosts.length === 0) {
    log.warn('  no hosts selected; nothing to stamp.');
    return;
  }
  log.success(`  ${chosenHosts.join(', ')}`);

  log.step('Vault CLAUDE.md');
  const vault = await setupVault({ vaultPath: config.vaultPath, flavor: config.flavor });
  log.info(`  ${vault.claudeMdAction}`);

  if (chosenHosts.includes('claude')) {
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

    log.step('Memory routing');
    const mem = await applyMemoryRouting({
      disableNative: config.memoryRouting === 'vault-only',
    });
    log.info(mem.changed ? '  settings.json env updated' : '  settings.json already correct');

    log.step('SessionStart hook');
    const hookScript = await copyClaudeHooks({ flavor: config.flavor });
    const hookReg = await applyMetalmindSessionStartHook({ hookCommand: hookScript.hookCommand });
    log.info(`  script: ${hookScript.action}`);
    log.info(
      hookReg.changed ? '  settings.json: registered' : '  settings.json: already registered',
    );

    log.step('Output-style rename: terse → telegraph (legacy migration)');
    const styleMigration = await migrateTerseToTelegraph();
    if (styleMigration.migrated) {
      if (styleMigration.fileRenamed) log.info('  ~/.claude/output-styles/terse.md → telegraph.md');
      if (styleMigration.settingsUpdated)
        log.info('  settings.json: outputStyle terse → telegraph');
    } else {
      log.info('  no legacy terse style found; nothing to migrate');
    }

    log.step('Output-style activation hook');
    const outputStyleHookReg = await applyOutputStyleSessionStartHook({
      hookCommand: hookScript.outputStyleHookCommand,
    });
    log.info(`  script: ${hookScript.outputStyleAction}`);
    log.info(
      outputStyleHookReg.changed
        ? '  settings.json: registered'
        : '  settings.json: already registered',
    );

    log.step('Output-style re-anchor hook (per-turn drift guard)');
    const outputStyleReanchorReg = await applyOutputStyleUserPromptSubmitHook({
      hookCommand: hookScript.outputStyleReanchorHookCommand,
    });
    log.info(`  script: ${hookScript.outputStyleReanchorAction}`);
    log.info(
      outputStyleReanchorReg.changed
        ? '  settings.json: registered (UserPromptSubmit)'
        : '  settings.json: already registered',
    );
  }

  if (chosenHosts.includes('codex')) {
    log.step('Codex CLI integration');
    const codexResult = await installCodex({
      vaultPath: config.vaultPath,
      flavor: config.flavor,
      eodHook: config.skills.eodHook,
      notifications: config.skills.notifications,
      withMcp: opts.withMcp ?? false,
    });
    log.info(`  AGENTS.md: ${codexResult.agentsMd}`);
    log.info(`  hook script: ${codexResult.hookScript}; hooks.json: ${codexResult.hooksJson}`);
    log.info(`  network_access: ${codexResult.networkAccess}`);
    log.info(`  prefix rules: ${codexResult.prefixRules}`);
    log.info(`  skills: ${codexResult.skills.join(', ')}`);
    if (codexResult.mcp === 'codex-not-found') {
      log.warn('  --with-mcp requested but `codex` binary not on PATH; skipped MCP registration.');
    } else {
      log.info(`  MCP server: ${codexResult.mcp}`);
    }
  }

  log.step('Shell aliases');
  const aliases = await installAliases();
  log.info(`  aliases.sh written; sourced in ${aliases.appendedTo.length} shell rc file(s)`);

  // Persist the chosen hosts back to config so subsequent --no-prompt uses
  // the right set. Skipped if we're stamping the exact same set already
  // in config (no-op). Schema enforces nonempty; chosenHosts.length > 0
  // is guaranteed by the early-return above when length === 0.
  const hostsChanged =
    chosenHosts.length !== config.hosts.length ||
    chosenHosts.some((h) => !config.hosts.includes(h));
  if (hostsChanged && chosenHosts.length > 0) {
    await writeConfig({
      ...config,
      hosts: chosenHosts as [MetalmindHost, ...MetalmindHost[]],
    });
    log.info(`  hosts updated → ${chosenHosts.join(', ')}`);
  }

  if (!opts.skipWatcher) {
    log.step('Python package (metalmind-vault-rag)');
    try {
      // Preserve the [rerank] extra across upgrades. Users who opted into the
      // heavy tier shouldn't silently lose it when stamp force-reinstalls the
      // package after a version bump.
      const hadRerank = await hasRerankExtraInstalled();
      const rag = await installVaultRag(hadRerank ? { extras: ['rerank'] } : {});
      if (rag.installed) {
        log.info(
          hadRerank
            ? '  refreshed from bundled source (kept [rerank] extra)'
            : '  refreshed from bundled source',
        );
      } else if (rag.alreadyInstalled) {
        log.info('  already current');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`  skipped: ${message}`);
    }

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
