import { cancel, confirm, intro, isCancel, log, outro, select } from '@clack/prompts';
import {
  type Config,
  CURRENT_CONFIG_VERSION,
  type MetalmindHost,
  readConfig,
  writeConfig,
} from '../config.js';
import { describeAliasSourcing, installAliases } from './aliases.js';
import { installCodex } from './codex.js';
import { installCursor } from './cursor.js';
import { setupVaultGit } from './git.js';
import { removeGraphifyResidue } from './graphify-legacy.js';
import { promptHosts } from './host-prompt.js';
import { registerMcpServers } from './mcp.js';
import { type FlavorChoice, installOutputStyle } from './output-style.js';
import { detectPrereqs, type PrereqResult } from './prereqs.js';
import { runPendingRepairs } from './repair.js';
import { installSerena } from './serena.js';
import {
  applyAgentTeams,
  applyMemoryRouting,
  applyMetalmindSessionStartHook,
  applyOutputStyleSessionStartHook,
  applyOutputStyleUserPromptSubmitHook,
} from './settings.js';
import {
  appendGlobalGitignore,
  copyClaudeHooks,
  copyClaudeTemplates,
  stampClaudeMd,
} from './templates.js';
import { installUv, UV_INSTALL_COMMAND } from './uv.js';
import { promptVaultPath, setupVault } from './vault.js';
import { installVaultRag, resolveWatcherBinPath } from './vault-rag.js';
import { installWatcher } from './watcher.js';

export interface RunWizardOptions {
  vaultPath?: string;
  serena?: boolean;
  enableTeams?: boolean;
  flavor?: 'scadrial' | 'classic';
  skipWatcher?: boolean;
  memoryRouting?: 'vault-only' | 'both';
  eodHook?: boolean;
  notifications?: boolean;
  vaultGit?: boolean;
  autoInstallUv?: boolean;
  /** When set, skip the host multi-select and use this exact host set. */
  hosts?: MetalmindHost[];
  /** Opt-in MCP registration for Codex. Off by default. */
  withMcp?: boolean;
  /** Memory surface only - skips Serena, subagents, team commands, and the
   *  deliberation skill. Lets the recall thesis be evaluated without
   *  installing the workflow layer. */
  core?: boolean;
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

  const priorConfig = await readConfig().catch(() => null);

  log.step('Checking prerequisites');
  let prereqs = await detectPrereqs();
  let summary = summarisePrereqs(prereqs);

  // uv has the only sanctioned one-line installer of any prereq. Offer to
  // run it inline so a fresh laptop doesn't bounce off the prereq wall.
  const uvFailing = summary.failing.find((r) => r.name === 'uv');
  if (uvFailing) {
    let runIt: boolean;
    if (opts.autoInstallUv !== undefined) {
      runIt = opts.autoInstallUv;
    } else {
      const answer = await confirm({
        message: `uv not found - install it now via the official Astral installer? (\`${UV_INSTALL_COMMAND}\`)`,
        initialValue: true,
      });
      checkCancelled(answer, 'uv auto-install prompt');
      runIt = answer;
    }
    if (runIt) {
      log.step('Installing uv');
      const result = await installUv();
      if (result.installed) {
        log.success(`  uv installed at ${result.binPath}`);
        if (result.pathPrepended) log.info('  prepended ~/.local/bin to PATH for this session');
        prereqs = await detectPrereqs();
        summary = summarisePrereqs(prereqs);
      } else {
        log.error(`  uv installer failed: ${result.stderr ?? 'unknown error'}`);
      }
    }
  }

  for (const r of prereqs) {
    if (r.ok) log.success(`${r.name.padEnd(14)} ${r.detail}`);
    else {
      log.error(`${r.name.padEnd(14)} ${r.detail}`);
      if (r.remediation) log.info(`  → ${r.remediation}`);
    }
  }
  if (summary.failing.length > 0) {
    outro(
      `${summary.failing.length} prereq(s) failing. Fix them and re-run. ${summary.passed} passing.`,
    );
    throw new Error('prereqs failed');
  }

  const vaultPathInput =
    opts.vaultPath ??
    (await promptVaultPath().catch((err) => {
      cancel(String(err));
      throw err;
    }));

  const core = opts.core === true;
  if (core) {
    log.info('Core install: memory surface only (no Serena, subagents, or team commands).');
  }

  let serena: boolean;
  if (core && opts.serena === undefined) {
    serena = false;
  } else if (opts.serena !== undefined) {
    serena = opts.serena;
  } else {
    const answer = await confirm({
      message: 'Install Serena (LSP-based code navigation)?',
      initialValue: true,
    });
    checkCancelled(answer, 'Serena prompt');
    serena = answer;
  }

  let flavor: 'scadrial' | 'classic';
  if (opts.flavor !== undefined) {
    flavor = opts.flavor;
  } else {
    const answer = await select({
      message: 'Theme - affects command spelling and help text',
      initialValue: 'scadrial',
      options: [
        { value: 'scadrial', label: 'Scadrial - Mistborn Era 1 verbs (tap copper, burn steel)' },
        { value: 'classic', label: 'Classic - neutral verbs (recall, rename)' },
      ],
    });
    checkCancelled(answer, 'theme prompt');
    flavor = answer as 'scadrial' | 'classic';
  }
  const styleChoice: FlavorChoice = flavor === 'scadrial' ? 'marsh' : 'telegraph';

  let memoryRouting: 'vault-only' | 'both';
  if (opts.memoryRouting !== undefined) {
    memoryRouting = opts.memoryRouting;
  } else {
    const answer = await select({
      message: 'Memory routing - where should Claude persist recalled context?',
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
  if (core && opts.enableTeams === undefined) {
    enableTeams = false;
  } else if (opts.enableTeams !== undefined) {
    enableTeams = opts.enableTeams;
  } else {
    const answer = await confirm({
      message: 'Enable agent teams (experimental multi-Claude orchestration)?',
      initialValue: false,
    });
    checkCancelled(answer, 'Teams prompt');
    enableTeams = answer;
  }

  let eodHook: boolean;
  if (core && opts.eodHook === undefined) {
    eodHook = false;
  } else if (opts.eodHook !== undefined) {
    eodHook = opts.eodHook;
  } else {
    const answer = await confirm({
      message:
        "End-of-day hook in /save: when you save between 16:00-18:00 local, offer to push pending items into tomorrow's daily note?",
      initialValue: true,
    });
    checkCancelled(answer, 'EOD hook prompt');
    eodHook = answer;
  }

  const isMac = process.platform === 'darwin';
  let notifications: boolean;
  if (core && opts.notifications === undefined) {
    notifications = false;
  } else if (opts.notifications !== undefined) {
    notifications = opts.notifications;
  } else if (!isMac) {
    notifications = false;
  } else {
    const answer = await confirm({
      message:
        'Fire macOS desktop notifications (flare/notify commands, used by /save to confirm writes)?',
      initialValue: true,
    });
    checkCancelled(answer, 'Notifications prompt');
    notifications = answer;
  }

  let vaultGit: boolean;
  if (opts.vaultGit !== undefined) {
    vaultGit = opts.vaultGit;
  } else {
    const answer = await confirm({
      message:
        'Track the vault in git? (versioning + multi-device sync via your own remote - skipped cleanly if it is already a repo)',
      initialValue: true,
    });
    checkCancelled(answer, 'Vault git prompt');
    vaultGit = answer;
  }

  log.step('Setting up vault');
  const vault = await setupVault({ vaultPath: vaultPathInput, flavor });
  log.success(`Vault at ${vault.vaultPath}`);
  if (vault.claudeMdAction === 'created') log.info('  wrote vault CLAUDE.md');
  else if (vault.claudeMdAction === 'inserted')
    log.info('  inserted metalmind block into vault CLAUDE.md');
  else if (vault.claudeMdAction === 'updated')
    log.info('  refreshed metalmind block in vault CLAUDE.md');
  if (vault.createdFolders.length > 0) log.info(`  created: ${vault.createdFolders.join(', ')}`);

  if (vaultGit) {
    log.step('Tracking vault in git');
    const git = await setupVaultGit({ vaultPath: vault.vaultPath, enable: true });
    if (git.action === 'initialized') log.success(`  git init at ${vault.vaultPath}`);
    else if (git.action === 'already-tracked')
      log.info('  vault was already a git repo - skipped init');
    if (git.gitignoreAction === 'created') log.info('  wrote .gitignore');
    else if (git.gitignoreAction === 'inserted')
      log.info('  inserted metalmind block into .gitignore');
    else if (git.gitignoreAction === 'updated')
      log.info('  refreshed metalmind block in .gitignore');
    if (git.initialCommit) log.info('  made initial commit');
    if (git.commitWarning) log.warn(`  initial commit skipped: ${git.commitWarning}`);
    log.info(`  add a remote with: git -C ${vault.vaultPath} remote add origin <url>`);
  }

  if (serena) {
    log.step('Installing Serena');
    const result = await installSerena();
    if (result.alreadyInstalled) log.info('  serena already on PATH - skipped install');
    if (result.installed) log.success('  uv tool install serena-agent complete');
    if (result.wroteConfig) log.info(`  wrote ${result.configPath}`);
  }

  const graphifyResidue = await removeGraphifyResidue();
  if (graphifyResidue.removedAnything) {
    log.step('Clearing retired graphify integration');
    if (graphifyResidue.claudeUnwired) log.info('  removed the graphify PreToolUse hook');
    if (graphifyResidue.homeStampRemoved) log.info('  cleaned the graphify stamp from ~/CLAUDE.md');
    if (graphifyResidue.uninstalled) log.info('  uv tool uninstall graphifyy complete');
  }

  log.step('Installing vault-rag (MCP server + watcher + indexer + doctor)');
  const vaultRag = await installVaultRag();
  if (vaultRag.alreadyInstalled) log.info('  metalmind-vault-rag already on PATH - skipped');
  if (vaultRag.installed) log.success('  uv tool install metalmind-vault-rag complete');

  if (opts.skipWatcher) {
    log.warn('Skipping watcher install (opts.skipWatcher)');
  } else {
    log.step('Installing watcher service');
    const watcherBinPath = await resolveWatcherBinPath();
    const watcher = await installWatcher({
      vaultPath: vault.vaultPath,
      watcherBin: watcherBinPath,
    });
    if (watcher.wroteUnit) log.success(`  wrote ${watcher.unitPath}`);
    if (watcher.started) {
      log.info(
        watcher.platform === 'darwin'
          ? '  launchctl load succeeded'
          : '  systemctl --user enable --now succeeded',
      );
    }
  }

  // Host selection - always prompted so newly-installed hosts (e.g. user
  // installed Codex after a CC-only stamp) surface for opt-in. Forced via
  // opts.hosts (--host claude|codex|both); pre-checks v0.7.x default of
  // ['claude'] when no prior choice is recorded.
  log.step('Choosing hosts');
  const hostsResult = await promptHosts({
    forced: opts.hosts,
    preChecked: ['claude'],
  });
  if (hostsResult.cancelled) {
    cancel('Cancelled.');
    throw new Error('host-prompt cancelled');
  }
  const chosenHosts = hostsResult.hosts;
  if (chosenHosts.length === 0) {
    log.warn(
      '  no hosts selected; metalmind will be installed locally but neither Claude Code nor Codex will be wired.',
    );
  } else {
    log.success(`  chosen: ${chosenHosts.join(', ')}`);
  }
  const installClaude = chosenHosts.includes('claude');
  const installCodexHost = chosenHosts.includes('codex');
  const installCursorHost = chosenHosts.includes('cursor');

  let stylePriorValue: string | null = null;
  let stampedOutputStyle: FlavorChoice | null = null;

  if (installClaude) {
    log.step('Registering MCP servers (serena)');
    const mcp = await registerMcpServers({ serena });
    if (mcp.added.length > 0) log.success(`  added: ${mcp.added.join(', ')}`);
    if (mcp.skipped.length > 0) log.info(`  already present: ${mcp.skipped.join(', ')}`);

    log.step('Configuring agent teams');
    const teams = await applyAgentTeams({ enable: enableTeams });
    if (teams.changed) {
      if (enableTeams) {
        if (teams.envSet)
          log.success(`  set env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in ${teams.settingsPath}`);
        if (teams.teammateModeSet)
          log.success(`  set teammateMode="tmux" in ${teams.settingsPath}`);
      } else {
        log.info(`  cleared agent-teams keys from ${teams.settingsPath}`);
      }
    } else {
      log.info(enableTeams ? '  agent teams already enabled' : '  agent teams already disabled');
    }

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

    log.step('Installing SessionStart hook (so every session knows memory is here)');
    const hookScript = await copyClaudeHooks({ flavor });
    const hookReg = await applyMetalmindSessionStartHook({ hookCommand: hookScript.hookCommand });
    log.success(`  ${hookScript.action} ${hookScript.hookScriptPath}`);
    log.info(
      hookReg.changed ? '  registered in settings.json → SessionStart' : '  already registered',
    );

    log.step('Installing output-style activation hook (re-anchors style against drift)');
    const outputStyleHookReg = await applyOutputStyleSessionStartHook({
      hookCommand: hookScript.outputStyleHookCommand,
    });
    log.success(`  ${hookScript.outputStyleAction} ${hookScript.outputStyleHookScriptPath}`);
    log.info(
      outputStyleHookReg.changed
        ? '  registered in settings.json → SessionStart'
        : '  already registered',
    );

    log.step('Installing output-style re-anchor hook (per-turn drift guard)');
    const outputStyleReanchorReg = await applyOutputStyleUserPromptSubmitHook({
      hookCommand: hookScript.outputStyleReanchorHookCommand,
    });
    log.success(
      `  ${hookScript.outputStyleReanchorAction} ${hookScript.outputStyleReanchorHookScriptPath}`,
    );
    log.info(
      outputStyleReanchorReg.changed
        ? '  registered in settings.json → UserPromptSubmit'
        : '  already registered',
    );

    log.step('Copying rules, agents, commands');
    const tpl = await copyClaudeTemplates({
      withTeams: enableTeams,
      flavor,
      eodHook,
      notifications,
      core,
    });
    log.success(`  wrote ${tpl.copied.length} files`);
    if (tpl.backupDir) {
      log.warn(
        `  ${tpl.backedUp.length} file(s) you had edited were replaced: ${tpl.backedUp.join(', ')}`,
      );
      log.info(`  previous versions saved to ${tpl.backupDir}`);
    }
    const claudeMd = await stampClaudeMd({ vaultPath: vault.vaultPath, flavor });
    if (claudeMd.starterWritten) log.info(`  wrote starter ${claudeMd.path}`);
    if (claudeMd.blockAction === 'created') log.info(`  wrote metalmind block → ${claudeMd.path}`);
    else if (claudeMd.blockAction === 'inserted')
      log.info(`  inserted metalmind block → ${claudeMd.path}`);
    else if (claudeMd.blockAction === 'updated')
      log.info(`  refreshed metalmind block → ${claudeMd.path}`);
    else log.info(`  metalmind block up to date in ${claudeMd.path}`);

    log.step(`Installing ${styleChoice} output-style`);
    const style = await installOutputStyle({ choice: styleChoice });
    if (style.migrated) log.success(`  migrated legacy style → ${style.stylePath}`);
    else if (style.installed) log.success(`  copied bundled style → ${style.stylePath}`);
    else if (style.updated) log.success(`  refreshed stale style from asset → ${style.stylePath}`);
    else log.info(`  ${style.stylePath} already present - kept`);
    if (style.priorValue) log.info(`  prior settings.json outputStyle: ${style.priorValue}`);
    stylePriorValue = style.priorValue;
    stampedOutputStyle = styleChoice;
  }

  if (installCodexHost) {
    log.step('Installing Codex CLI integration');
    const codexResult = await installCodex({
      vaultPath: vault.vaultPath,
      flavor,
      eodHook,
      notifications,
      withMcp: opts.withMcp ?? false,
    });
    log.info(`  AGENTS.md: ${codexResult.agentsMd}`);
    log.info(`  hook script: ${codexResult.hookScript}; hooks.json: ${codexResult.hooksJson}`);
    log.info(`  network_access: ${codexResult.networkAccess}`);
    log.info(`  prefix rules: ${codexResult.prefixRules}`);
    log.info(`  skills: ${codexResult.skills.join(', ')}`);
    if (codexResult.mcp === 'codex-not-found') {
      log.warn(
        '  --with-mcp requested but `codex` binary not on PATH; skipped MCP registration. Install Codex CLI and rerun `metalmind stamp --host codex --with-mcp`.',
      );
    } else {
      log.info(`  MCP server: ${codexResult.mcp}`);
    }
  }

  if (installCursorHost) {
    log.step('Installing Cursor integration');
    const cursorResult = await installCursor({
      vaultPath: vault.vaultPath,
      flavor,
      withMcp: opts.withMcp ?? false,
    });
    log.info(`  skills: ${cursorResult.skills.join(', ')}`);
    log.info(`  agents: ${cursorResult.agents.length} copied`);
    log.info(`  hook script: ${cursorResult.hookScript}; hooks.json: ${cursorResult.hooksJson}`);
    log.info(`  MCP server: ${cursorResult.mcp}`);
  }

  log.step('Updating global gitignore');
  const gi = await appendGlobalGitignore();
  if (gi.added.length > 0) log.info(`  added: ${gi.added.join(', ')} to ${gi.path}`);

  log.step('Installing shell aliases');
  const aliases = await installAliases();
  if (aliases.noRcFilesFound) log.warn(`  ${describeAliasSourcing(aliases)}`);
  else log.success(`  ${aliases.aliasesPath}; ${describeAliasSourcing(aliases)}`);

  const config: Config = {
    version: CURRENT_CONFIG_VERSION,
    flavor,
    vaultPath: vault.vaultPath,
    outputStyle: { installed: stampedOutputStyle, priorValue: stylePriorValue },
    embeddings: priorConfig?.embeddings ?? { provider: 'local', baseURL: null },
    recall: priorConfig?.recall ?? { defaultTier: 'fast', httpEndpoint: null },
    verbose: priorConfig?.verbose ?? false,
    mcp: {
      registered: [...(serena ? ['serena'] : [])],
    },
    memoryRouting,
    hooks: { claudeCode: priorConfig?.hooks.claudeCode ?? false },
    forge: priorConfig?.forge ?? { groups: {} },
    skills: { eodHook, notifications },
    hosts:
      chosenHosts.length > 0 ? (chosenHosts as [MetalmindHost, ...MetalmindHost[]]) : ['claude'],
  };
  if (priorConfig) {
    const keptRepos = Object.values(config.forge.groups).reduce(
      (n, g) => n + (g.repos?.length ?? 0),
      0,
    );
    if (keptRepos > 0) {
      log.info(
        `  kept ${Object.keys(config.forge.groups).length} forge group(s), ${keptRepos} repo(s)`,
      );
    }
  }
  await writeConfig(config);
  log.success('Wrote ~/.metalmind/config.json');

  const verifyCmd = flavor === 'scadrial' ? 'pulse' : 'doctor';
  if (core) {
    log.info('Core install complete. Re-run `metalmind init` without --core to add the rest.');
  }
  outro(`Installed. Run \`metalmind ${verifyCmd}\` to verify.`);
  return config;
}
