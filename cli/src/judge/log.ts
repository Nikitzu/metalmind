import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { JudgeResult } from './client.js';

/** One judge call, without any note or query text: enough to audit the
 *  verdicts and their cost later, nothing that would leak content. */
export interface JudgeLogEntry {
  ts: string;
  command: 'scribe-create' | 'scribe-update' | 'tap';
  model: string;
  latency_ms: number;
  unjudged?: string;
  usage?: { input_tokens: number; output_tokens: number };
  answers: Array<{
    id: string;
    file?: string;
    score?: number;
    noul?: number;
    confidence?: number;
    probabilities?: Record<string, number>;
  }>;
  decision: string;
  forced?: boolean;
  /** Opt-in (config.judge.logContent): what the judge actually saw, for later review. */
  content?: {
    query?: string;
    draft?: { title: string; head: string };
    candidates?: Array<{ id: string; title: string; head: string }>;
  };
  /** Human verdict from `judge review`. */
  label?: 'right' | 'wrong';
  /** Files the user opened with `scribe show` shortly after a judged tap. */
  opened?: string[];
}

export const CONTENT_HEAD_CHARS = 300;

export function head(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, CONTENT_HEAD_CHARS);
}

export function judgeLogPath(): string {
  return process.env.METALMIND_JUDGE_LOG ?? join(homedir(), '.metalmind', 'judge-log.jsonl');
}

export function entryFromResult(
  base: Pick<JudgeLogEntry, 'command' | 'model' | 'latency_ms' | 'decision' | 'forced'>,
  res: JudgeResult,
  files: Record<string, string | undefined>,
): JudgeLogEntry {
  const answers = Object.entries(res.answers ?? {}).map(([id, a]) => ({
    id,
    file: files[id],
    ...(a.type === 'noul' ? { noul: a.noul } : {}),
    ...(a.type === 'score' ? { score: a.score } : {}),
    ...(a.type !== 'noul' ? { confidence: a.confidence, probabilities: a.probabilities } : {}),
  }));
  return {
    ts: new Date().toISOString(),
    ...base,
    ...(res.unjudged
      ? { unjudged: res.status ? `${res.unjudged} ${res.status}` : res.unjudged }
      : {}),
    ...(res.usage ? { usage: res.usage } : {}),
    answers,
  };
}

export async function appendJudgeLog(entry: JudgeLogEntry, path = judgeLogPath()): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    return;
  }
}

/** Rewrite the whole log with `update` applied to each entry. The log is
 *  small (one line per call) and only the owner writes it, so a full rewrite
 *  is simpler than an index. */
export async function updateJudgeLog(
  update: (entry: JudgeLogEntry, index: number) => JudgeLogEntry,
  path = judgeLogPath(),
): Promise<number> {
  const entries = await readJudgeLog(path);
  const next = entries.map(update);
  const changed = next.filter((e, i) => e !== entries[i]).length;
  if (changed > 0) {
    await writeFile(path, `${next.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
  }
  return changed;
}

export async function readJudgeLog(path = judgeLogPath()): Promise<JudgeLogEntry[]> {
  try {
    const text = await readFile(path, 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as JudgeLogEntry];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

// A note opened soon after a judged recall is the closest thing to a click:
// it says which hit the reader actually wanted.
export const OPENED_WINDOW_MS = 10 * 60_000;

export async function markOpenedAfterTap(file: string, path = judgeLogPath()): Promise<boolean> {
  const entries = await readJudgeLog(path);
  const cutoff = Date.now() - OPENED_WINDOW_MS;
  let target = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as JudgeLogEntry;
    if (e.command !== 'tap') continue;
    if (Date.parse(e.ts) < cutoff) break;
    target = i;
    break;
  }
  if (target === -1) return false;
  const changed = await updateJudgeLog(
    (e, i) =>
      i === target && !(e.opened ?? []).includes(file)
        ? { ...e, opened: [...(e.opened ?? []), file] }
        : e,
    path,
  );
  return changed > 0;
}
