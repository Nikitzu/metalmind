import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cancel, confirm, intro, isCancel, log, outro } from '@clack/prompts';
import { readConfig } from '../config.js';
import { DEFAULT_CODEX_DIR, uninstallCodex } from '../install/codex.js';
import { DEFAULT_CURSOR_DIR, uninstallCursor } from '../install/cursor.js';
import { teardown } from '../install/teardown.js';

const STACK_COMPOSE_REL = '.metalmind-stack/compose.yml';

export interface UninstallOptions {
  yes?: boolean;
  purge?: boolean;
}

export async function uninstall(opts: UninstallOptions = {}): Promise<void> {
  intro('metalmind uninstall');

  const config = await readConfig();
  if (!config) {
    log.warn('No metalmind config found. Running best-effort cleanup anyway.');
  } else {
    log.info(`Will remove install configured for vault at ${config.vaultPath}`);
  }

  // Was this a legacy install with the Qdrant + Ollama Docker stack? If so,
  // surface the Docker-specific prompts and copy. Embedded installs (the
  // v0.5.0 default) don't have a stack to stop or volumes to delete.
  const legacyStack =
    config?.vaultPath !== undefined && existsSync(join(config.vaultPath, STACK_COMPOSE_REL));

  // Detect Codex install footprint: either config says so, or our sentinel
  // files exist on disk. The latter handles the case where ~/.metalmind/
  // config.json got deleted but our codex stamps survive (best-effort
  // cleanup path).
  const codexAgentsPath = join(DEFAULT_CODEX_DIR, 'AGENTS.md');
  const codexRulesPath = join(DEFAULT_CODEX_DIR, 'rules', 'metalmind.rules');
  const codexInstalled =
    (config?.hosts.includes('codex') ?? false) ||
    existsSync(codexAgentsPath) ||
    existsSync(codexRulesPath);

  // Detect Cursor install footprint: config flag or our sentinel files on disk.
  const cursorSkillPath = join(DEFAULT_CURSOR_DIR, 'skills', 'metalmind-recall', 'SKILL.md');
  const cursorHooksPath = join(DEFAULT_CURSOR_DIR, 'hooks.json');
  const cursorInstalled =
    (config?.hosts.includes('cursor') ?? false) ||
    existsSync(cursorSkillPath) ||
    existsSync(cursorHooksPath);

  log.warn('This will:');
  log.info(legacyStack ? '  - stop watcher and Docker stack' : '  - stop watcher');
  if (legacyStack) {
    log.info('  - remove <vault>/.metalmind-stack/ (stack code, NOT your notes)');
  }
  log.info('  - remove MCP entries (vault-rag, serena) from ~/.claude.json');
  log.info('  - remove shell aliases + source line from ~/.zshrc and ~/.bashrc');
  log.info(
    '  - strip the metalmind managed blocks from ~/.claude/CLAUDE.md and <vault>/CLAUDE.md (user content outside the markers is preserved)',
  );
  log.info(
    '  - remove the SessionStart hook script + its entry in ~/.claude/settings.json (other hooks preserved)',
  );
  if (codexInstalled) {
    log.info(
      '  - strip Codex stamps from ~/.codex/ (AGENTS.md sentinel, hooks.json entry, hook script, network_access block, metalmind.rules, our skills); also `codex mcp remove metalmind` if registered',
    );
  }
  if (cursorInstalled) {
    log.info(
      '  - strip Cursor stamps from ~/.cursor/ (metalmind-recall skill, our subagents, hooks.json entry, hook script); also the metalmind entry in mcp.json if registered',
    );
  }
  log.info('  - optionally uninstall the metalmind-vault-rag uv tool (prompt)');
  log.info('  - delete ~/.metalmind/config.json');
  log.info(
    'Will NOT touch: your notes, ~/.claude/agents, ~/.claude/rules, custom content in your CLAUDE.md files, ~/.codex/memories, ~/.codex/rules/default.rules',
  );

  let removeSerena: boolean;
  let removeGraphify: boolean;
  let removeVaultRag: boolean;
  let removeVolumes: boolean;

  if (opts.yes) {
    log.info(
      `Non-interactive (--yes): removeVaultRag=true, removeSerena=false, removeGraphify=false, removeVolumes=${opts.purge === true}`,
    );
    removeSerena = false;
    removeGraphify = false;
    removeVaultRag = true;
    removeVolumes = opts.purge === true;
  } else {
    const proceed = await confirm({ message: 'Proceed?', initialValue: false });
    if (isCancel(proceed) || !proceed) {
      cancel('aborted');
      return;
    }

    const s = await confirm({
      message: 'Also uninstall Serena (uv tool uninstall)?',
      initialValue: false,
    });
    if (isCancel(s)) {
      cancel('aborted');
      return;
    }
    removeSerena = s;

    const g = await confirm({
      message: 'Also uninstall graphify (uv tool uninstall)?',
      initialValue: false,
    });
    if (isCancel(g)) {
      cancel('aborted');
      return;
    }
    removeGraphify = g;

    const v = await confirm({
      message:
        'Also uninstall metalmind-vault-rag (uv tool uninstall — the watcher, indexer, and HTTP recall server)?',
      initialValue: true,
    });
    if (isCancel(v)) {
      cancel('aborted');
      return;
    }
    removeVaultRag = v;

    if (legacyStack) {
      const vol = await confirm({
        message: 'Remove Docker volumes (Qdrant data, Ollama models ~274 MB)?',
        initialValue: false,
      });
      if (isCancel(vol)) {
        cancel('aborted');
        return;
      }
      removeVolumes = vol;
    } else {
      removeVolumes = false;
    }
  }

  try {
    if (codexInstalled) {
      const codex = await uninstallCodex({ removeMcp: true });
      if (codex.agentsMd) log.success('Stripped metalmind block from ~/.codex/AGENTS.md');
      if (codex.hooksJson) log.success('Removed SessionStart entry from ~/.codex/hooks.json');
      if (codex.hookScript) log.success('Deleted ~/.codex/hooks/metalmind-session-start.sh');
      if (codex.networkAccess)
        log.success('Stripped network_access block from ~/.codex/config.toml');
      if (codex.prefixRules) log.success('Deleted ~/.codex/rules/metalmind.rules');
      if (codex.skills.length > 0) log.success(`Removed Codex skills: ${codex.skills.join(', ')}`);
      if (codex.mcp === 'removed') log.success('codex mcp remove metalmind succeeded');
      else if (codex.mcp === 'codex-not-found')
        log.info('codex binary not on PATH — skipped MCP unregister (no-op since not registered)');
    }

    if (cursorInstalled) {
      const cursor = await uninstallCursor({ removeMcp: true });
      if (cursor.skills.length > 0)
        log.success(`Removed Cursor skills: ${cursor.skills.join(', ')}`);
      if (cursor.agents.length > 0) log.success(`Removed ${cursor.agents.length} Cursor subagents`);
      if (cursor.hooksJson) log.success('Removed sessionStart entry from ~/.cursor/hooks.json');
      if (cursor.hookScript)
        log.success('Deleted ~/.cursor/hooks/metalmind-cursor-session-start.sh');
      if (cursor.mcp === 'removed') log.success('Removed metalmind entry from ~/.cursor/mcp.json');
    }

    const claudeDir = join(homedir(), '.claude');
    const result = await teardown({
      claudeDir,
      settingsPath: join(claudeDir, 'settings.json'),
      config: config ?? undefined,
      removeSerena,
      removeGraphify,
      removeVaultRag,
      removeVolumes,
    });
    if (result.watcher.removedPlist) log.success('launchd watcher unloaded + plist removed');
    if (result.stackStopped) log.success('Docker stack stopped');
    if (result.stackRemoved) log.success('<vault>/.metalmind-stack removed');
    if (result.serenaUninstalled) log.success('Serena uninstalled');
    if (result.graphifyUninstalled) log.success('graphify uninstalled');
    if (result.vaultRagUninstalled) log.success('metalmind-vault-rag uninstalled');
    if (result.mcp.removed.length > 0)
      log.success(`MCP entries removed: ${result.mcp.removed.join(', ')}`);
    if (result.aliases.removedAliases) log.success('Aliases file removed');
    if (result.aliases.removedSourceLine) log.success('.zshrc source line removed');
    if (result.outputStyle.styleRemoved) log.success('Output-style file removed');
    if (result.outputStyle.settingsRestored) log.success('settings.json outputStyle restored');
    if (result.claudeMdBlocks.global === 'removed' || result.claudeMdBlocks.global === 'file-empty')
      log.success('Stripped metalmind block from ~/.claude/CLAUDE.md');
    if (result.claudeMdBlocks.vault === 'removed' || result.claudeMdBlocks.vault === 'file-empty')
      log.success('Stripped metalmind block from vault CLAUDE.md');
    if (result.sessionStartHook.registrationCleared)
      log.success('SessionStart hook entry removed from settings.json');
    if (result.sessionStartHook.scriptRemoved)
      log.success('SessionStart hook script removed from ~/.claude/hooks/');
    if (result.configRemoved) log.success('~/.metalmind/config.json deleted');
    outro('Uninstall complete. Your vault notes are untouched.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`uninstall failed: ${message}`);
    process.exitCode = 1;
  }
}
