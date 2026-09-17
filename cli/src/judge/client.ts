import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const JUDGE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const KEYCHAIN_SERVICE = 'typesafe-api-key';
// A judgment decorates a local command; past this it costs more attention than it saves.
export const JUDGE_TIMEOUT_MS = 4_000;
// Enough for the lede and first sections of a note; the whole body would cost tokens for no better verdict.
export const STATE_CAP_CHARS = 2_000;

export type Unjudged = 'no-key' | 'offline' | 'timeout' | 'rejected';
export type KeySource = 'env' | 'keychain' | 'pass' | 'none';
export const PASS_ENTRY = 'typesafe-api-key';

export interface JudgeConfig {
  enabled: boolean;
  model: string;
}

export type Question =
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number };

export interface JudgeResult {
  answers: Record<string, Answer> | null;
  unjudged?: Unjudged;
  status?: number;
  usage?: { input_tokens: number; output_tokens: number };
}

export function judgeEnabled(cfg: JudgeConfig): boolean {
  return cfg.enabled && process.env.METALMIND_JUDGE !== '0';
}

async function keychainKey(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
    ]);
    return stdout;
  } catch {
    return '';
  }
}

async function passKey(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('pass', ['show', PASS_ENTRY]);
    return stdout.split('\n')[0] ?? '';
  } catch {
    return '';
  }
}

export async function resolveJudgeKey(
  opts: {
    keychain?: () => Promise<string>;
    pass?: () => Promise<string>;
    platform?: NodeJS.Platform;
  } = {},
): Promise<{ key: string | null; source: KeySource }> {
  const env = process.env.TYPESAFE_API_KEY?.trim();
  if (env) return { key: env, source: 'env' };
  const platform = opts.platform ?? process.platform;
  if (platform === 'darwin') {
    const kc = (await (opts.keychain ?? keychainKey)()).trim();
    if (kc) return { key: kc, source: 'keychain' };
  }
  const fromPass = (await (opts.pass ?? passKey)()).trim();
  if (fromPass) return { key: fromPass, source: 'pass' };
  return { key: null, source: 'none' };
}

export async function storeJudgeKey(
  key: string,
  opts: {
    platform?: NodeJS.Platform;
    user?: string;
    exec?: (cmd: string, args: string[], input?: string) => Promise<unknown>;
  } = {},
): Promise<{ stored: 'keychain' | 'pass' | 'none' }> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? execWithInput;
  if (platform === 'darwin') {
    const user = opts.user ?? process.env.USER ?? 'metalmind';
    await exec('security', [
      'add-generic-password',
      '-a',
      user,
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
      key,
      '-U',
    ]);
    return { stored: 'keychain' };
  }
  try {
    await exec('pass', ['insert', '-m', '-f', PASS_ENTRY], `${key}\n`);
    return { stored: 'pass' };
  } catch {
    return { stored: 'none' };
  }
}

function execWithInput(cmd: string, args: string[], input?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    if (input !== undefined) child.stdin?.end(input);
  });
}

export function clipForState(body: string): string {
  const stripped = body.startsWith('---\n') ? body.replace(/^---\n[\s\S]*?\n---\n?/, '') : body;
  return stripped.slice(0, STATE_CAP_CHARS);
}

export function unjudgedLine(res: JudgeResult): string {
  if (!res.unjudged) return '';
  const reason = res.unjudged === 'rejected' ? `rejected ${res.status ?? ''}`.trim() : res.unjudged;
  return `unjudged: ${reason}`;
}

export async function judge(opts: {
  state: unknown;
  questions: Record<string, Question>;
  model: string;
  keychain?: () => Promise<string>;
}): Promise<JudgeResult> {
  const { key } = await resolveJudgeKey({ keychain: opts.keychain });
  if (!key) return { answers: null, unjudged: 'no-key' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  try {
    const res = await fetch(JUDGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: opts.model, state: opts.state, questions: opts.questions }),
      signal: controller.signal,
    });
    if (!res.ok) return { answers: null, unjudged: 'rejected', status: res.status };
    const json = (await res.json()) as {
      answers?: Record<string, Answer>;
      usage?: { input_tokens: number; output_tokens: number };
    };
    return { answers: json.answers ?? null, usage: json.usage };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { answers: null, unjudged: 'timeout' };
    }
    return { answers: null, unjudged: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}
