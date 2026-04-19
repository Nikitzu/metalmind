import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { intro, log, outro } from '@clack/prompts';
import { CONFIG_PATH, type Config, readConfig } from '../config.js';
import { detectPrereqs } from '../install/prereqs.js';
import { OLLAMA_CONTAINER } from '../install/stack.js';
import { runCommand } from '../util/exec.js';

export interface DoctorOptions {
  deep?: boolean;
}

export interface DeepCheck {
  name: string;
  ok: boolean;
  detail: string;
  remediation?: string;
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
  const names = new Set(res.stdout.split('\n').map((l) => l.trim()).filter(Boolean));
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
      remediation: points === 0 ? 'Collection is empty — run `metalmind-vault-rag-indexer`.' : undefined,
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
    return { name: 'recall-http', ok: true, detail: 'fast-path endpoint reachable (127.0.0.1:17317)' };
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
    const res = await runCommand('systemctl', ['--user', 'is-active', 'metalmind-vault-indexer.service']);
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

async function runDeepChecks(config: Config): Promise<DeepCheck[]> {
  const docker = await checkDockerContainers();
  const [qdrant, ollama, watcher, http, ...stamps] = await Promise.all([
    checkQdrantCollection(),
    checkOllamaModel(),
    checkWatcherService(),
    checkRecallHttp(),
    ...(await checkClaudeMdSentinel(config)).map((c) => Promise.resolve(c)),
  ]);
  return [...docker, qdrant!, ollama!, watcher!, http!, ...stamps];
}

export async function doctor(invokedAs = 'doctor', opts: DoctorOptions = {}): Promise<void> {
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
    log.info(`outputStyle:    ${config.outputStyle.installed}`);
    log.info(`embeddings:     ${config.embeddings.provider}`);
    log.info(`recall.default: ${config.recall.defaultTier}`);
    log.info(`mcp:            ${config.mcp.registered.join(', ') || '(none)'}`);
    log.info(`hooks.claude:   ${config.hooks.claudeCode}`);
    log.info(`forge.groups:   ${Object.keys(config.forge.groups).join(', ') || '(none)'}`);
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
