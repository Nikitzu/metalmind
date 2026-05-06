import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { intro, log, outro } from '@clack/prompts';
import { CONFIG_PATH, type Config, readConfig } from '../config.js';
import {
  DEFAULT_CODEX_DIR,
  DEFAULT_CODEX_MCP_NAME,
  DEFAULT_METALMIND_HTTP_URL,
  METALMIND_CODEX_HOOK_FILENAME,
  METALMIND_CODEX_SKILLS,
  METALMIND_RULES_FILENAME,
} from '../install/codex.js';
import { detectPrereqs } from '../install/prereqs.js';
import { OLLAMA_CONTAINER } from '../install/stack.js';
import { runCommand } from '../util/exec.js';
import { detectObsidian } from '../util/obsidian.js';

export interface DoctorOptions {
  deep?: boolean;
  recallAudit?: boolean;
  recallAuditDays?: number;
}

const DEFAULT_RECALL_LOG_PATH = join(homedir(), '.metalmind', 'recall-log.ndjson');
const ZERO_HIT_SCORE_FLOOR = 0.3;

export interface DeepCheck {
  name: string;
  ok: boolean;
  detail: string;
  remediation?: string;
}

/**
 * Probe whether the legacy Qdrant + Ollama Docker stack is active. The
 * default v0.5.0 install runs sqlite-vec + fastembed in-process, so the
 * docker/qdrant/ollama checks are noise for those users. Returns the
 * Set of running metalmind container names — empty Set means no stack.
 */
async function detectLegacyStack(): Promise<Set<string>> {
  const res = await runCommand('docker', ['ps', '--format', '{{.Names}}']);
  if (!res.ok) return new Set();
  return new Set(
    res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((n) => n === 'metalmind-qdrant' || n === 'metalmind-ollama'),
  );
}

export async function checkDockerContainers(): Promise<DeepCheck[]> {
  const res = await runCommand('docker', ['ps', '--format', '{{.Names}}']);
  if (!res.ok) {
    return [
      {
        name: 'docker-ps',
        ok: false,
        detail: 'docker ps failed',
        remediation: 'Ensure Docker Desktop is running.',
      },
    ];
  }
  const names = new Set(
    res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  return [
    {
      name: 'metalmind-ollama',
      ok: names.has('metalmind-ollama'),
      detail: names.has('metalmind-ollama') ? 'running' : 'not running',
      remediation: names.has('metalmind-ollama') ? undefined : 'Run `vault-up` to start the stack.',
    },
    {
      name: 'metalmind-qdrant',
      ok: names.has('metalmind-qdrant'),
      detail: names.has('metalmind-qdrant') ? 'running' : 'not running',
      remediation: names.has('metalmind-qdrant') ? undefined : 'Run `vault-up` to start the stack.',
    },
  ];
}

export async function checkQdrantCollection(): Promise<DeepCheck> {
  try {
    const res = await fetch('http://localhost:6333/collections/vault');
    if (!res.ok) {
      return {
        name: 'qdrant-collection',
        ok: false,
        detail: `vault collection missing (HTTP ${res.status})`,
        remediation: 'Run `metalmind-vault-rag-indexer` to build the collection.',
      };
    }
    const json = (await res.json()) as { result?: { points_count?: number } };
    const points = json.result?.points_count ?? 0;
    return {
      name: 'qdrant-collection',
      ok: points > 0,
      detail: `${points} points`,
      remediation:
        points === 0 ? 'Collection is empty — run `metalmind-vault-rag-indexer`.' : undefined,
    };
  } catch (err) {
    return {
      name: 'qdrant-collection',
      ok: false,
      detail: `unreachable: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Start the stack: `vault-up`.',
    };
  }
}

export async function checkOllamaModel(): Promise<DeepCheck> {
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    if (!res.ok) {
      return {
        name: 'ollama-model',
        ok: false,
        detail: `ollama not ready (HTTP ${res.status})`,
        remediation: 'Wait for ollama to finish booting, or `vault-up`.',
      };
    }
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    const hasEmbed = (json.models ?? []).some((m) => m.name?.includes('nomic-embed-text'));
    return {
      name: 'ollama-model',
      ok: hasEmbed,
      detail: hasEmbed ? 'nomic-embed-text present' : 'nomic-embed-text missing',
      remediation: hasEmbed
        ? undefined
        : `Run \`docker exec ${OLLAMA_CONTAINER} ollama pull nomic-embed-text\`.`,
    };
  } catch (err) {
    return {
      name: 'ollama-model',
      ok: false,
      detail: `unreachable: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Start the stack: `vault-up`.',
    };
  }
}

export async function checkRecallHttp(): Promise<DeepCheck> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('http://127.0.0.1:17317/health', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        name: 'recall-http',
        ok: false,
        detail: `endpoint up but returned HTTP ${res.status}`,
        remediation: 'Check watcher logs: `tail ~/Knowledge/.metalmind-stack/watcher.err`.',
      };
    }
    return {
      name: 'recall-http',
      ok: true,
      detail: 'fast-path endpoint reachable (127.0.0.1:17317)',
    };
  } catch {
    return {
      name: 'recall-http',
      ok: false,
      detail: 'fast-path endpoint unreachable — tap copper will fall back to stdio MCP',
      remediation: 'Watcher not running or port 17317 in use. Check `vault-watcher-status`.',
    };
  }
}

export async function checkWatcherService(): Promise<DeepCheck> {
  if (platform() === 'darwin') {
    const res = await runCommand('launchctl', ['list']);
    if (!res.ok) {
      return { name: 'watcher', ok: false, detail: 'launchctl list failed' };
    }
    const loaded = res.stdout.includes('com.metalmind.vault-indexer');
    return {
      name: 'watcher',
      ok: loaded,
      detail: loaded ? 'launchd loaded' : 'not loaded',
      remediation: loaded ? undefined : 'Run `metalmind burn brass` to re-install the watcher.',
    };
  }
  if (platform() === 'linux') {
    const res = await runCommand('systemctl', [
      '--user',
      'is-active',
      'metalmind-vault-indexer.service',
    ]);
    const active = res.stdout.trim() === 'active';
    return {
      name: 'watcher',
      ok: active,
      detail: active ? 'systemd --user active' : `not active (${res.stdout.trim() || 'missing'})`,
      remediation: active
        ? undefined
        : 'Run `systemctl --user start metalmind-vault-indexer.service` or `metalmind burn brass`.',
    };
  }
  return { name: 'watcher', ok: false, detail: `unsupported platform ${platform()}` };
}

export async function checkClaudeMdSentinel(config: Config): Promise<DeepCheck[]> {
  const claudeMd = join(process.env.HOME ?? '', '.claude', 'CLAUDE.md');
  const vaultMd = join(config.vaultPath, 'CLAUDE.md');
  const results: DeepCheck[] = [];
  for (const path of [claudeMd, vaultMd]) {
    const name = path === claudeMd ? 'global-claude-md' : 'vault-claude-md';
    if (!existsSync(path)) {
      results.push({
        name,
        ok: false,
        detail: 'missing',
        remediation: 'Run `metalmind burn brass` to re-stamp.',
      });
      continue;
    }
    const { readFile } = await import('node:fs/promises');
    const contents = await readFile(path, 'utf8');
    const hasBlock = contents.includes('<!-- metalmind:managed:begin -->');
    results.push({
      name,
      ok: hasBlock,
      detail: hasBlock ? 'sentinel block present' : 'sentinel block missing',
      remediation: hasBlock ? undefined : 'Run `metalmind burn brass` to re-stamp.',
    });
  }
  return results;
}

/**
 * Codex per-host deep checks: AGENTS.md sentinel, hooks.json registration,
 * sandbox network_access, prefix rules, skills, optional MCP server.
 * Only invoked when config.hosts.includes('codex'); skipped otherwise.
 */
export async function checkCodexInstall(opts: {
  codexDir?: string;
  checkMcp?: boolean;
  /** Override $HOME for the ~/.agents/skills/ mirror probe (test injection). */
  homeDir?: string;
} = {}): Promise<DeepCheck[]> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const homeDirPath = opts.homeDir ?? homedir();
  const out: DeepCheck[] = [];

  // 1. AGENTS.md sentinel
  const agentsPath = join(codexDir, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const content = await readFile(agentsPath, 'utf8');
    const present = content.includes('<!-- metalmind:codex:agents:begin -->');
    out.push({
      name: 'codex-agents-md',
      ok: present,
      detail: present ? 'sentinel block present' : 'sentinel block missing',
      remediation: present ? undefined : 'Run `metalmind stamp --host codex` to re-stamp.',
    });
  } else {
    out.push({
      name: 'codex-agents-md',
      ok: false,
      detail: 'AGENTS.md not stamped',
      remediation: 'Run `metalmind stamp --host codex`.',
    });
  }

  // 2. SessionStart hook (script + hooks.json entry)
  const hookScriptPath = join(codexDir, 'hooks', METALMIND_CODEX_HOOK_FILENAME);
  out.push({
    name: 'codex-hook-script',
    ok: existsSync(hookScriptPath),
    detail: existsSync(hookScriptPath) ? hookScriptPath : 'missing',
    remediation: existsSync(hookScriptPath)
      ? undefined
      : 'Run `metalmind stamp --host codex`.',
  });

  const hooksJsonPath = join(codexDir, 'hooks.json');
  if (existsSync(hooksJsonPath)) {
    try {
      const data = JSON.parse(await readFile(hooksJsonPath, 'utf8')) as {
        hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: string }> }> };
      };
      const groups = data?.hooks?.SessionStart ?? [];
      const ours = groups.find((g) =>
        g.hooks?.some((h) => typeof h?.command === 'string' && h.command.includes(METALMIND_CODEX_HOOK_FILENAME)),
      );
      out.push({
        name: 'codex-hooks-json',
        ok: ours !== undefined,
        detail: ours !== undefined ? 'SessionStart entry registered' : 'SessionStart entry missing',
        remediation: ours !== undefined ? undefined : 'Run `metalmind stamp --host codex`.',
      });
    } catch (err) {
      out.push({
        name: 'codex-hooks-json',
        ok: false,
        detail: `parse error: ${err instanceof Error ? err.message : String(err)}`,
        remediation: 'Inspect ~/.codex/hooks.json for invalid JSON.',
      });
    }
  } else {
    out.push({
      name: 'codex-hooks-json',
      ok: false,
      detail: 'hooks.json absent',
      remediation: 'Run `metalmind stamp --host codex`.',
    });
  }

  // 3. Sandbox network_access
  const configTomlPath = join(codexDir, 'config.toml');
  if (existsSync(configTomlPath)) {
    const content = await readFile(configTomlPath, 'utf8');
    const ok =
      content.includes('# metalmind:codex:network:begin') &&
      content.includes('network_access = true');
    out.push({
      name: 'codex-network-access',
      ok,
      detail: ok ? 'sentinel block present + network_access=true' : 'sentinel missing or value wrong',
      remediation: ok ? undefined : 'Run `metalmind stamp --host codex`.',
    });
  } else {
    out.push({
      name: 'codex-network-access',
      ok: false,
      detail: 'config.toml absent',
      remediation: 'Run `metalmind stamp --host codex`.',
    });
  }

  // 4. Prefix rules
  const rulesPath = join(codexDir, 'rules', METALMIND_RULES_FILENAME);
  if (existsSync(rulesPath)) {
    const content = await readFile(rulesPath, 'utf8');
    const ok = content.includes('prefix_rule(["metalmind", "tap"]');
    out.push({
      name: 'codex-prefix-rules',
      ok,
      detail: ok ? rulesPath : 'malformed (no metalmind tap allow)',
      remediation: ok ? undefined : 'Run `metalmind stamp --host codex`.',
    });
  } else {
    out.push({
      name: 'codex-prefix-rules',
      ok: false,
      detail: 'metalmind.rules absent',
      remediation: 'Run `metalmind stamp --host codex`.',
    });
  }

  // 5. Skills
  const skillsRoot = join(codexDir, 'skills');
  const present = METALMIND_CODEX_SKILLS.filter((s) => existsSync(join(skillsRoot, s, 'SKILL.md')));
  out.push({
    name: 'codex-skills',
    ok: present.length === METALMIND_CODEX_SKILLS.length,
    detail:
      present.length === METALMIND_CODEX_SKILLS.length
        ? present.join(', ')
        : `missing: ${METALMIND_CODEX_SKILLS.filter((s) => !present.includes(s)).join(', ')}`,
    remediation:
      present.length === METALMIND_CODEX_SKILLS.length
        ? undefined
        : 'Run `metalmind stamp --host codex`.',
  });

  // 7. Codex auto-mirrors ~/.claude/skills/ to ~/.agents/skills/ on first
  // launch (one-time copy, no auto-refresh). If we ever fixed source
  // SKILL.md files post-mirror, the stale broken copies persist and
  // Codex logs `Skipped loading N skill(s)` on every launch. Detect by
  // checking whether our .shared/-sourced skills' on-disk content
  // differs from the live ~/.agents/skills/ copy.
  const agentsSkillsDir = join(homeDirPath, '.agents', 'skills');
  const mirrorIssues: string[] = [];
  for (const skill of ['writing-vault-notes', 'synod']) {
    const mirrorPath = join(agentsSkillsDir, skill, 'SKILL.md');
    const cclPath = join(homeDirPath, '.claude', 'skills', skill, 'SKILL.md');
    if (!existsSync(mirrorPath) || !existsSync(cclPath)) continue;
    const mirror = await readFile(mirrorPath, 'utf8');
    const ccl = await readFile(cclPath, 'utf8');
    if (mirror !== ccl) mirrorIssues.push(skill);
  }
  if (mirrorIssues.length > 0) {
    out.push({
      name: 'codex-agents-mirror',
      ok: false,
      detail: `~/.agents/skills/{${mirrorIssues.join(',')}} stale vs ~/.claude/skills/ — Codex skips these on every launch with "Skipped loading N skill(s) due to invalid SKILL.md files"`,
      remediation: `rm -rf ${mirrorIssues.map((s) => `~/.agents/skills/${s}`).join(' ')}`,
    });
  } else if (existsSync(agentsSkillsDir)) {
    out.push({
      name: 'codex-agents-mirror',
      ok: true,
      detail: '~/.agents/skills/ in sync with ~/.claude/skills/',
    });
  }

  // 6. MCP (only when --check-mcp / --deep, since it spawns a subprocess).
  // The MCP server is OPT-IN via --with-mcp; absence is not a failure.
  // Mark not-registered as ok=true with informational detail so the doctor
  // summary doesn't flag a non-issue.
  //
  // Disambiguate "binary missing" from "command failed/timed out" via a
  // first `which codex` probe. `codex mcp list --json` may legitimately
  // time out (5s default in runCommand) when the user has live stdio MCP
  // servers (e.g. MCP_DOCKER) registered — Codex pings each one to report
  // status, which can exceed 5s. Misattributing that as "binary not on
  // PATH" was the v0.8.0 doctor lie this v0.8.1 patch fixes.
  if (opts.checkMcp) {
    const which = await runCommand('which', ['codex']);
    if (!which.ok) {
      out.push({
        name: 'codex-mcp',
        ok: true,
        detail: 'codex binary not on PATH — MCP check skipped (opt-in feature)',
      });
    } else {
    const res = await runCommand('codex', ['mcp', 'list', '--json']);
    if (!res.ok) {
      out.push({
        name: 'codex-mcp',
        ok: true,
        detail:
          'codex mcp list failed or timed out — MCP check skipped (opt-in feature; common when live MCP servers slow Codex to ping)',
      });
    } else {
      try {
        const list = JSON.parse(res.stdout) as Array<{ name: string; url?: string }>;
        const ours = list.find((e) => e.name === DEFAULT_CODEX_MCP_NAME);
        if (ours === undefined) {
          out.push({
            name: 'codex-mcp',
            ok: true,
            detail: 'not registered — opt-in via `metalmind stamp --host codex --with-mcp`',
          });
        } else {
          const urlMatches = ours.url === DEFAULT_METALMIND_HTTP_URL;
          out.push({
            name: 'codex-mcp',
            ok: urlMatches,
            detail: urlMatches
              ? `${DEFAULT_CODEX_MCP_NAME} → ${ours.url}`
              : `${DEFAULT_CODEX_MCP_NAME} registered with unexpected url: ${ours.url ?? '(none)'}`,
            remediation: urlMatches
              ? undefined
              : 'Re-run `metalmind stamp --host codex --with-mcp` to refresh the URL.',
          });
        }
      } catch {
        out.push({
          name: 'codex-mcp',
          ok: false,
          detail: 'codex mcp list returned non-JSON',
        });
      }
    }
    }
  }

  return out;
}

async function runDeepChecks(config: Config): Promise<DeepCheck[]> {
  // Only fire the docker/qdrant/ollama probes when the user is actually
  // on the legacy stack. Default v0.5.0 installs run sqlite-vec +
  // fastembed in-process; surfacing "metalmind-qdrant: not running" as a
  // doctor failure for those users would be confusing noise.
  const legacyContainers = await detectLegacyStack();
  const onLegacy = legacyContainers.size > 0;

  const installClaude = config.hosts.includes('claude');
  const installCodex = config.hosts.includes('codex');

  const stamps = installClaude ? await checkClaudeMdSentinel(config) : [];
  const codexChecks = installCodex ? await checkCodexInstall({ checkMcp: true }) : [];

  const [watcher, http] = await Promise.all([checkWatcherService(), checkRecallHttp()]);

  if (!onLegacy) {
    return [watcher, http, ...stamps, ...codexChecks];
  }

  const docker = await checkDockerContainers();
  const [qdrant, ollama] = await Promise.all([
    checkQdrantCollection(),
    checkOllamaModel(),
  ]);
  return [...docker, qdrant, ollama, watcher, http, ...stamps, ...codexChecks];
}

interface RecallLogEntry {
  ts: string;
  query: string;
  mode: string;
  rerank: boolean;
  k: number;
  hit_count: number;
  top_files: string[];
  top_score: number | null;
}

function parseRecallLog(path: string, sinceMs: number): RecallLogEntry[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const out: RecallLogEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as RecallLogEntry;
      const t = Date.parse(e.ts);
      if (Number.isFinite(t) && t >= sinceMs) out.push(e);
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

function classifyEntry(e: RecallLogEntry): 'zero-hit' | 'weak-hit' | 'ok' {
  if (e.hit_count === 0) return 'zero-hit';
  const top = e.top_score;
  if (typeof top === 'number' && top < ZERO_HIT_SCORE_FLOOR) return 'weak-hit';
  return 'ok';
}

async function runRecallAudit(opts: DoctorOptions): Promise<void> {
  const path = process.env.METALMIND_RECALL_LOG_PATH ?? DEFAULT_RECALL_LOG_PATH;
  const days = opts.recallAuditDays ?? 7;
  const sinceMs = Date.now() - days * 86400 * 1000;

  log.step(`Recall audit (last ${days} day(s))`);
  if (!existsSync(path)) {
    log.warn(`No recall log at ${path}.`);
    log.info(
      'Set `METALMIND_RECALL_LOG_PATH=~/.metalmind/recall-log.ndjson` in the watcher env, ' +
        'restart the watcher, and run a few queries before re-running this audit.',
    );
    return;
  }

  const entries = parseRecallLog(path, sinceMs);
  if (entries.length === 0) {
    log.info(`Log exists at ${path} but no entries within the window.`);
    return;
  }

  const buckets = { 'zero-hit': 0, 'weak-hit': 0, ok: 0 };
  const weak: RecallLogEntry[] = [];
  for (const e of entries) {
    const cls = classifyEntry(e);
    buckets[cls] += 1;
    if (cls !== 'ok') weak.push(e);
  }

  log.success(
    `${entries.length} queries scanned · ok=${buckets.ok} · weak=${buckets['weak-hit']} · zero=${buckets['zero-hit']}`,
  );

  if (weak.length === 0) {
    log.success('No weak or zero-hit queries — recall is healthy on the recent window.');
    return;
  }

  log.step('Candidates for /save (queries that returned little)');
  const groups = new Map<string, { query: string; count: number; cls: string }>();
  for (const e of weak) {
    const key = e.query.trim().toLowerCase();
    const cls = classifyEntry(e);
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      if (cls === 'zero-hit') g.cls = 'zero-hit';
    } else {
      groups.set(key, { query: e.query, count: 1, cls });
    }
  }
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 25);
  for (const g of ranked) {
    const tag = g.cls === 'zero-hit' ? '0-hit' : 'weak ';
    const times = g.count > 1 ? ` (${g.count}×)` : '';
    log.info(`[${tag}]${times} ${g.query}`);
  }
  log.info('');
  log.info('Workflow: open the relevant note in your vault, refine it, then `/save` ' + 'to surface a future query.');
}

export async function doctor(invokedAs = 'doctor', opts: DoctorOptions = {}): Promise<void> {
  if (opts.recallAudit) {
    intro(`metalmind ${invokedAs} --recall-audit`);
    await runRecallAudit(opts);
    outro('Audit complete.');
    return;
  }
  intro(`metalmind ${invokedAs}${opts.deep ? ' --deep' : ''}`);

  log.step('Prerequisites');
  const prereqs = await detectPrereqs();
  for (const r of prereqs) {
    if (r.ok) {
      log.success(`${r.name.padEnd(14)} ${r.detail}`);
    } else {
      log.error(`${r.name.padEnd(14)} ${r.detail}`);
      if (r.remediation) log.info(`  → ${r.remediation}`);
    }
  }
  const failed = prereqs.filter((r) => !r.ok).length;

  log.step('Config');
  const config = await readConfig();
  if (!config) {
    log.warn(`No config at ${CONFIG_PATH}`);
    log.info('Run `metalmind init` to perform the interactive setup.');
  } else {
    log.success(`Config at ${CONFIG_PATH}`);
    log.info(`flavor:         ${config.flavor}`);
    log.info(`vaultPath:      ${config.vaultPath}`);
    log.info(`hosts:          ${config.hosts.join(', ')}`);
    log.info(`outputStyle:    ${config.outputStyle.installed ?? '(none — codex-only install)'}`);
    log.info(`embeddings:     ${config.embeddings.provider}`);
    log.info(`recall.default: ${config.recall.defaultTier}`);
    log.info(`mcp:            ${config.mcp.registered.join(', ') || '(none)'}`);
    log.info(`hooks.claude:   ${config.hooks.claudeCode}`);
    log.info(`forge.groups:   ${Object.keys(config.forge.groups).join(', ') || '(none)'}`);

    const obsidian = await detectObsidian();
    if (obsidian.found) {
      log.info(`obsidian:       detected (${obsidian.location})`);
    } else {
      log.info('obsidian:       not detected — vault works without it');
      log.info(`  install hint: ${obsidian.installHint}`);
    }
  }

  let deepFailed = 0;
  if (opts.deep && config) {
    log.step('Runtime');
    const deep = await runDeepChecks(config);
    for (const c of deep) {
      if (c.ok) log.success(`${c.name.padEnd(22)} ${c.detail}`);
      else {
        log.error(`${c.name.padEnd(22)} ${c.detail}`);
        if (c.remediation) log.info(`  → ${c.remediation}`);
        deepFailed++;
      }
    }
  }

  const totalFailed = failed + deepFailed;
  const summary =
    totalFailed === 0 && config
      ? 'All systems nominal.'
      : totalFailed > 0
        ? `${totalFailed} issue(s) flagged — see remediation above.`
        : 'Prereqs ok; no config — run `metalmind init`.';
  outro(summary);

  if (totalFailed > 0) process.exitCode = 1;
}
