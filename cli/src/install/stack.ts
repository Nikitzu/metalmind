import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';
import { getTemplatesDir } from '../util/paths.js';

export const STACK_SUBDIR = '.claude-stack';
export const OLLAMA_URL = 'http://localhost:11434/api/tags';
export const QDRANT_URL = 'http://localhost:6333/readyz';
export const EMBED_MODEL = 'nomic-embed-text';
export const OLLAMA_CONTAINER = 'knowledge-ollama';

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface SetupStackOptions {
  vaultPath: string;
  templatesDir?: string;
  dryRun?: boolean;
  fetchFn?: FetchFn;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface SetupStackResult {
  stackDir: string;
  started: boolean;
  ollamaReady: boolean;
  qdrantReady: boolean;
  modelPulled: boolean;
  actionsSkipped: string[];
}

export async function copyStackTemplates(vaultPath: string, templatesDir: string): Promise<string> {
  const stackDir = join(vaultPath, STACK_SUBDIR);
  await mkdir(stackDir, { recursive: true });
  await cp(join(templatesDir, 'claude-stack'), stackDir, { recursive: true });
  return stackDir;
}

export async function startStack(stackDir: string): Promise<void> {
  const res = await runCommand(
    'docker',
    ['compose', '-f', join(stackDir, 'compose.yml'), 'up', '-d'],
    { timeoutMs: 120_000 },
  );
  if (!res.ok) {
    throw new Error(`docker compose up failed: ${res.stderr || res.stdout}`);
  }
}

export async function stopStack(stackDir: string): Promise<void> {
  const res = await runCommand('docker', ['compose', '-f', join(stackDir, 'compose.yml'), 'down'], {
    timeoutMs: 60_000,
  });
  if (!res.ok) {
    throw new Error(`docker compose down failed: ${res.stderr || res.stdout}`);
  }
}

export async function waitForHttp(
  url: string,
  opts: { timeoutMs?: number; intervalMs?: number; fetchFn?: FetchFn } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const fetchFn = opts.fetchFn ?? fetch;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchFn(url);
      if (res.ok) return true;
    } catch {
      // service not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function pullEmbeddingModel(): Promise<void> {
  const res = await runCommand(
    'docker',
    ['exec', OLLAMA_CONTAINER, 'ollama', 'pull', EMBED_MODEL],
    { timeoutMs: 600_000 },
  );
  if (!res.ok) {
    throw new Error(`ollama pull ${EMBED_MODEL} failed: ${res.stderr || res.stdout}`);
  }
}

export async function setupStack(opts: SetupStackOptions): Promise<SetupStackResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const result: SetupStackResult = {
    stackDir: '',
    started: false,
    ollamaReady: false,
    qdrantReady: false,
    modelPulled: false,
    actionsSkipped: [],
  };

  result.stackDir = await copyStackTemplates(opts.vaultPath, templatesDir);

  if (opts.dryRun) {
    result.actionsSkipped.push(
      'docker compose up',
      'waitForOllama',
      'waitForQdrant',
      'ollama pull',
    );
    return result;
  }

  await startStack(result.stackDir);
  result.started = true;

  const [ollamaReady, qdrantReady] = await Promise.all([
    waitForHttp(OLLAMA_URL, {
      timeoutMs: opts.pollTimeoutMs,
      intervalMs: opts.pollIntervalMs,
      fetchFn: opts.fetchFn,
    }),
    waitForHttp(QDRANT_URL, {
      timeoutMs: opts.pollTimeoutMs,
      intervalMs: opts.pollIntervalMs,
      fetchFn: opts.fetchFn,
    }),
  ]);
  result.ollamaReady = ollamaReady;
  result.qdrantReady = qdrantReady;

  if (!ollamaReady) throw new Error(`Ollama not reachable at ${OLLAMA_URL}`);
  if (!qdrantReady) throw new Error(`Qdrant not reachable at ${QDRANT_URL}`);

  await pullEmbeddingModel();
  result.modelPulled = true;

  return result;
}
