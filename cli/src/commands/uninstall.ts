import { cancel, confirm, intro, isCancel, log, outro } from '@clack/prompts';
import { readConfig } from '../config.js';
import { teardown } from '../install/teardown.js';

export async function uninstall(): Promise<void> {
  intro('metalmind uninstall');

  const config = await readConfig();
  if (!config) {
    log.warn('No metalmind config found. Running best-effort cleanup anyway.');
  } else {
    log.info(`Will remove install configured for vault at ${config.vaultPath}`);
  }

  log.warn('This will:');
  log.info('  - stop watcher and Docker stack');
  log.info('  - remove <vault>/.metalmind-stack/ (stack code, NOT your notes)');
  log.info('  - remove MCP entries (vault-rag, serena) from ~/.claude.json');
  log.info('  - remove shell aliases + source line from ~/.zshrc and ~/.bashrc');
  log.info('  - strip the metalmind managed blocks from ~/.claude/CLAUDE.md and <vault>/CLAUDE.md (user content outside the markers is preserved)');
  log.info('  - delete ~/.metalmind/config.json');
  log.info('Will NOT touch: your notes, ~/.claude/agents, ~/.claude/rules, custom content in your CLAUDE.md files');

  const proceed = await confirm({ message: 'Proceed?', initialValue: false });
  if (isCancel(proceed) || !proceed) {
    cancel('aborted');
    return;
  }

  const removeSerena = await confirm({
    message: 'Also uninstall Serena (uv tool uninstall)?',
    initialValue: false,
  });
  if (isCancel(removeSerena)) {
    cancel('aborted');
    return;
  }

  const removeGraphify = await confirm({
    message: 'Also uninstall graphify (uv tool uninstall)?',
    initialValue: false,
  });
  if (isCancel(removeGraphify)) {
    cancel('aborted');
    return;
  }

  const removeVolumes = await confirm({
    message: 'Remove Docker volumes (Qdrant data, Ollama models ~274 MB)?',
    initialValue: false,
  });
  if (isCancel(removeVolumes)) {
    cancel('aborted');
    return;
  }

  try {
    const result = await teardown({
      config: config ?? undefined,
      removeSerena,
      removeGraphify,
      removeVolumes,
    });
    if (result.watcher.removedPlist) log.success('launchd watcher unloaded + plist removed');
    if (result.stackStopped) log.success('Docker stack stopped');
    if (result.stackRemoved) log.success('<vault>/.metalmind-stack removed');
    if (result.serenaUninstalled) log.success('Serena uninstalled');
    if (result.graphifyUninstalled) log.success('graphify uninstalled');
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
    if (result.configRemoved) log.success('~/.metalmind/config.json deleted');
    outro('Uninstall complete. Your vault notes are untouched.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`uninstall failed: ${message}`);
    process.exitCode = 1;
  }
}
