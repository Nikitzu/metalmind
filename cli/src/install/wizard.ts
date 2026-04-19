import { cancel, confirm, intro, isCancel, log, outro, select } from '@clack/prompts';
import { type Config, writeConfig } from '../config.js';
import { installAliases } from './aliases.js';
import { installGraphify } from './graphify.js';
import { installLaunchdWatcher } from './launchd.js';
import { registerMcpServers } from './mcp.js';
import { type FlavorChoice, installOutputStyle } from './output-style.js';
import { detectPrereqs, type PrereqResult } from './prereqs.js';
import { installSerena } from './serena.js';
import { applyMemoryRouting } from './settings.js';
import { setupStack } from './stack.js';
import { appendGlobalGitignore, copyClaudeTemplates, stampClaudeMd } from './templates.js';
import { installVaultRag, resolveWatcherBinPath } from './vault-rag.js';
import { promptVaultPath, setupVault } from './vault.js';

export interface RunWizardOptions {
  vaultPath?: string;
  serena?: boolean;
  graphify?: boolean;
  enableTeams?: boolean;
  flavor?: 'scadrial' | 'classic';
  skipDocker?: boolean;
  memoryRouting?: 'vault-only' | 'both';
}

function checkCancelled<T>(value: T | symbol, label: string): asserts value is T {
  if (isCancel(value)) {
    cancel(`${label} cancelled`);
    throw new Error(`wizard cancelled at ${label}`);
  }
}

function summarisePrereqs(results: PrereqResult[]): { failing: PrereqResult[]; passed: number } {
  const failing = results.filter((r) => !r.ok);
  return { failing, passed: results.length - failing.length };
}

export async function runWizard(opts: RunWizardOptions = {}): Promise<Config> {
  intro('metalmind init');

  log.step('Checking prerequisites');
  const prereqs = await detectPrereqs();
  const { failing, passed } = summarisePrereqs(prereqs);
  for (const r of prereqs) {
    if (r.ok) log.success(`${r.name.padEnd(14)} ${r.detail}`);
    else {
      log.error(`${r.name.padEnd(14)} ${r.detail}`);
      if (r.remediation) log.info(`  → ${r.remediation}`);
    }
  }
  if (failing.length > 0) {
    outro(`${failing.length} prereq(s) failing. Fix them and re-run. ${passed} passing.`);
    throw new Error('prereqs failed');
  }

  const vaultPathInput =
    opts.vaultPath ??
    (await promptVaultPath().catch((err) => {
      cancel(String(err));
      throw err;
    }));

  let serena: boolean;
  if (opts.serena !== undefined) {
    serena = opts.serena;
  } else {
    const answer = await confirm({
      message: 'Install Serena (LSP-based code navigation)?',
      initialValue: true,
    });
    checkCancelled(answer, 'Serena prompt');
    serena = answer;
  }

  let graphify: boolean;
  if (opts.graphify !== undefined) {
    graphify = opts.graphify;
  } else {
    const answer = await confirm({
      message: 'Install graphify (code graph + cross-repo intelligence)?',
      initialValue: true,
    });
    checkCancelled(answer, 'graphify prompt');
    graphify = answer;
  }

  let flavor: 'scadrial' | 'classic';
  if (opts.flavor !== undefined) {
    flavor = opts.flavor;
  } else {
    const answer = await select({
      message: 'Theme — affects command spelling and help text',
      initialValue: 'scadrial',
      options: [
        { value: 'scadrial', label: 'Scadrial — Mistborn Era 1 verbs (burn bronze, tap copper)' },
        { value: 'classic', label: 'Classic — neutral verbs (graph, recall)' },
      ],
    });
    checkCancelled(answer, 'theme prompt');
    flavor = answer as 'scadrial' | 'classic';
  }
  const styleChoice: FlavorChoice = flavor === 'scadrial' ? 'marsh' : 'terse';

  let memoryRouting: 'vault-only' | 'both';
  if (opts.memoryRouting !== undefined) {
    memoryRouting = opts.memoryRouting;
  } else {
    const answer = await select({
      message: 'Memory routing — where should Claude persist recalled context?',
      initialValue: 'vault-only',
      options: [
        {
          value: 'vault-only',
          label: 'Vault only (disable native auto-memory, route everything via metalmind)',
        },
        {
          value: 'both',
          label: 'Both (keep native auto-memory + vault, vault is primary)',
        },
      ],
    });
    checkCancelled(answer, 'memory routing prompt');
    memoryRouting = answer as 'vault-only' | 'both';
  }

  let enableTeams: boolean;
  if (opts.enableTeams !== undefined) {
    enableTeams = opts.enableTeams;
  } else {
    const answer = await confirm({
      message: 'Enable agent teams (experimental multi-Claude orchestration)?',
      initialValue: false,
    });
    checkCancelled(answer, 'Teams prompt');
    enableTeams = answer;
  }

  log.step('Setting up vault');
  const vault = await setupVault({ vaultPath: vaultPathInput, flavor });
  log.success(`Vault at ${vault.vaultPath}`);
  if (vault.wroteClaudeMd) log.info('  wrote vault CLAUDE.md');
  if (vault.createdFolders.length > 0) log.info(`  created: ${vault.createdFolders.join(', ')}`);

  if (serena) {
    log.step('Installing Serena');
    const result = await installSerena();
    if (result.alreadyInstalled) log.info('  serena already on PATH — skipped install');
    if (result.installed) log.success('  uv tool install serena-agent complete');
    if (result.wroteConfig) log.info(`  wrote ${result.configPath}`);
  }

  let graphifyHookWired = false;
  if (graphify) {
    log.step('Installing graphify');
    const result = await installGraphify();
    if (result.alreadyInstalled) log.info('  graphify already on PATH — skipped install');
    if (result.installed) log.success('  uv tool install graphifyy complete');
    if (result.claudeWired) log.info('  graphify claude install wired MCP + PreToolUse hook');
    graphifyHookWired = result.claudeWired;
  }

  log.step('Installing vault-rag (MCP server + watcher + indexer + doctor)');
  const vaultRag = await installVaultRag();
  if (vaultRag.alreadyInstalled) log.info('  metalmind-vault-rag already on PATH — skipped');
  if (vaultRag.installed) log.success('  uv tool install metalmind-vault-rag complete');

  if (!opts.skipDocker) {
    log.step('Starting Docker stack (Qdrant + Ollama)');
    const stack = await setupStack({ vaultPath: vault.vaultPath });
    log.success(`  stack at ${stack.stackDir}`);
    if (stack.modelPulled) log.info('  nomic-embed-text pulled');
  } else {
    log.warn('Skipping Docker stack (opts.skipDocker)');
  }

  log.step('Installing launchd watcher');
  const watcherBinPath = await resolveWatcherBinPath();
  const watcher = await installLaunchdWatcher({
    vaultPath: vault.vaultPath,
    watcherBin: watcherBinPath,
  });
  if (watcher.wrotePlist) log.success(`  wrote ${watcher.plistPath}`);
  if (watcher.loaded) log.info('  launchctl load succeeded');

  log.step('Registering MCP servers (serena/teams)');
  const mcp = await registerMcpServers({
    serena,
    enableTeams,
  });
  if (mcp.added.length > 0) log.success(`  added: ${mcp.added.join(', ')}`);
  if (mcp.skipped.length > 0) log.info(`  already present: ${mcp.skipped.join(', ')}`);

  log.step('Applying memory routing');
  const mem = await applyMemoryRouting({ disableNative: memoryRouting === 'vault-only' });
  if (mem.changed) {
    log.success(
      memoryRouting === 'vault-only'
        ? `  disabled native auto-memory in ${mem.settingsPath}`
        : `  native auto-memory re-enabled in ${mem.settingsPath}`,
    );
  } else {
    log.info(`  ${mem.settingsPath} already in desired state`);
  }

  log.step('Copying rules, agents, commands');
  const tpl = await copyClaudeTemplates({ withTeams: enableTeams });
  log.success(`  copied ${tpl.copied.length} files (${tpl.skipped.length} skipped)`);
  const claudeMd = await stampClaudeMd({ vaultPath: vault.vaultPath, flavor });
  if (claudeMd.wrote) log.info(`  wrote ${claudeMd.path}`);
  else log.info(`  ${claudeMd.path} exists — kept`);

  log.step('Updating global gitignore');
  const gi = await appendGlobalGitignore();
  if (gi.added.length > 0) log.info(`  added: ${gi.added.join(', ')} to ${gi.path}`);

  log.step('Installing shell aliases');
  const aliases = await installAliases();
  if (aliases.appendedSource) log.success(`  ${aliases.aliasesPath} + source line in .zshrc`);
  else if (aliases.zshrcMissing) log.warn('  no ~/.zshrc — add source line manually');

  log.step(`Installing ${styleChoice} output-style`);
  const style = await installOutputStyle({ choice: styleChoice });
  if (style.migrated) log.success(`  migrated legacy style → ${style.stylePath}`);
  else if (style.installed) log.success(`  copied bundled style → ${style.stylePath}`);
  else log.info(`  ${style.stylePath} already present — kept`);
  if (style.priorValue) log.info(`  prior settings.json outputStyle: ${style.priorValue}`);

  const config: Config = {
    version: 1,
    flavor,
    vaultPath: vault.vaultPath,
    graphifyCmd: 'graphify',
    outputStyle: { installed: styleChoice, priorValue: style.priorValue },
    embeddings: { provider: 'local', baseURL: null },
    recall: { defaultTier: 'fast' },
    verbose: false,
    mcp: {
      registered: [...(serena ? ['serena'] : []), ...(graphify ? ['graphify'] : [])],
    },
    memoryRouting,
    hooks: { claudeCode: graphifyHookWired },
    forge: { groups: {} },
  };
  await writeConfig(config);
  log.success('Wrote ~/.metalmind/config.json');

  const verifyCmd = flavor === 'scadrial' ? 'pulse' : 'doctor';
  outro(`Installed. Run \`metalmind ${verifyCmd}\` to verify.`);
  return config;
}
