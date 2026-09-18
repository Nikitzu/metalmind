import { appendFile, mkdir, readFile } from 'node:fs/promises';
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
