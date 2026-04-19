import { cancel, confirm, intro, isCancel, log, outro } from '@clack/prompts';
import { type Config, writeConfig } from '../config.js';
import { runCommand } from '../util/exec.js';
import { installAliases } from './aliases.js';
import { installLaunchdWatcher } from './launchd.js';
import { registerMcpServers } from './mcp.js';
import { detectPrereqs, type PrereqResult } from './prereqs.js';
import { installSerena } from './serena.js';
import { setupStack } from './stack.js';
import { appendGlobalGitignore, copyClaudeTemplates, stampClaudeMd } from './templates.js';
import { promptVaultPath, setupVault } from './vault.js';

export interface RunWizardOptions {
  vaultPath?: string;
  serena?: boolean;
  enableTeams?: boolean;
  skipDocker?: boolean;
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

async function resolveUvPath(): Promise<string> {
  const res = await runCommand('which', ['uv']);
  if (!res.ok || !res.stdout.trim()) {
    throw new Error('uv not found on PATH — install uv before running metalmind init');
  }
  return res.stdout.trim();
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
  const vault = await setupVault({ vaultPath: vaultPathInput });
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

  if (!opts.skipDocker) {
    log.step('Starting Docker stack (Qdrant + Ollama)');
    const stack = await setupStack({ vaultPath: vault.vaultPath });
    log.success(`  stack at ${stack.stackDir}`);
    if (stack.modelPulled) log.info('  nomic-embed-text pulled');
  } else {
    log.warn('Skipping Docker stack (opts.skipDocker)');
  }

  log.step('Installing launchd watcher');
  const uvPath = await resolveUvPath();
  const watcher = await installLaunchdWatcher({ vaultPath: vault.vaultPath, uvPath });
  if (watcher.wrotePlist) log.success(`  wrote ${watcher.plistPath}`);
  if (watcher.loaded) log.info('  launchctl load succeeded');

  log.step('Registering MCP servers');
  const mcp = await registerMcpServers({
    vaultPath: vault.vaultPath,
    serena,
    enableTeams,
  });
  if (mcp.added.length > 0) log.success(`  added: ${mcp.added.join(', ')}`);
  if (mcp.skipped.length > 0) log.info(`  already present: ${mcp.skipped.join(', ')}`);

  log.step('Copying rules, agents, commands');
  const tpl = await copyClaudeTemplates({ withTeams: enableTeams });
  log.success(`  copied ${tpl.copied.length} files (${tpl.skipped.length} skipped)`);
  const claudeMd = await stampClaudeMd({ vaultPath: vault.vaultPath });
  if (claudeMd.wrote) log.info(`  wrote ${claudeMd.path}`);
  else log.info(`  ${claudeMd.path} exists — kept`);

  log.step('Updating global gitignore');
  const gi = await appendGlobalGitignore();
  if (gi.added.length > 0) log.info(`  added: ${gi.added.join(', ')} to ${gi.path}`);

  log.step('Installing shell aliases');
  const aliases = await installAliases();
  if (aliases.appendedSource) log.success(`  ${aliases.aliasesPath} + source line in .zshrc`);
  else if (aliases.zshrcMissing) log.warn('  no ~/.zshrc — add source line manually');

  const config: Config = {
    version: 1,
    flavor: 'scadrial',
    vaultPath: vault.vaultPath,
    graphifyCmd: 'graphify',
    outputStyle: { installed: null, priorValue: null },
    embeddings: { provider: 'local', baseURL: null },
    recall: { defaultTier: 'fast' },
    mcp: { registered: ['vault-rag', ...(serena ? ['serena'] : [])] },
    hooks: { claudeCode: false },
    forge: { groups: {} },
  };
  await writeConfig(config);
  log.success('Wrote ~/.metalmind/config.json');

  outro('Installed. Run `metalmind doctor` to verify.');
  return config;
}
