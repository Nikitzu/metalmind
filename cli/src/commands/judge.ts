import { isCancel, log, select } from '@clack/prompts';
import { readConfig, writeConfig } from '../config.js';
import {
  type JudgeConfig,
  KEYCHAIN_SERVICE,
  type KeySource,
  PASS_ENTRY,
  resolveJudgeKey,
} from '../judge/client.js';
import { type JudgeLogEntry, judgeLogPath, readJudgeLog, updateJudgeLog } from '../judge/log.js';

export function renderJudgeStatus(
  cfg: JudgeConfig,
  key: { key: string | null; source: KeySource },
): string {
  const keyLine =
    key.source === 'env'
      ? 'key: env (TYPESAFE_API_KEY)'
      : key.source === 'keychain'
        ? `key: keychain (${KEYCHAIN_SERVICE})`
        : key.source === 'pass'
          ? `key: pass (${PASS_ENTRY})`
          : process.platform === 'darwin'
            ? `key: none (set TYPESAFE_API_KEY or add a Keychain item with service ${KEYCHAIN_SERVICE})`
            : `key: none (set TYPESAFE_API_KEY or pass insert ${PASS_ENTRY})`;
  const lines = [`enabled: ${cfg.enabled ? 'yes' : 'no'}`, keyLine, `model: ${cfg.model}`];
  if (!cfg.enabled) lines.push('turn on with: metalmind judge enable');
  return lines.join('\n');
}

export async function judgeStatusCmd(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) {
    log.error('No metalmind config. Run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${renderJudgeStatus(cfg.judge, await resolveJudgeKey())}\n`);
}

export async function judgeSetEnabledCmd(enabled: boolean): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) {
    log.error('No metalmind config. Run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }
  await writeConfig({ ...cfg, judge: { ...cfg.judge, enabled } });
  log.success(`judge ${enabled ? 'enabled' : 'disabled'}`);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function histogram(values: number[], edges: number[]): string {
  const counts = edges.map(() => 0);
  for (const v of values) {
    let idx = edges.findIndex((e) => v < e);
    if (idx === -1) idx = edges.length - 1;
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return edges
    .map((e, i) => {
      const label =
        i === 0 ? `<${e}` : i === edges.length - 1 ? `${edges[i - 1]}+` : `${edges[i - 1]}-${e}`;
      return `${label}:${counts[i]}`;
    })
    .join('  ');
}

export function renderJudgeReport(entries: JudgeLogEntry[], days: number): string {
  const since = Date.now() - days * 86_400_000;
  const recent = entries.filter((e) => Date.parse(e.ts) >= since);
  if (recent.length === 0) return `no judge calls in the last ${days} day(s) (${judgeLogPath()})`;
  const byCommand = (c: JudgeLogEntry['command']) => recent.filter((e) => e.command === c);
  const creates = [...byCommand('scribe-create'), ...byCommand('scribe-update')];
  const refused = creates.filter((e) => e.decision.startsWith('refused'));
  const forcedAfter = creates.filter((e) => e.forced && e.decision.startsWith('refused'));
  const uncertain = creates.filter((e) => e.decision.startsWith('uncertain'));
  const taps = byCommand('tap');
  const unjudged = recent.filter((e) => e.unjudged);
  const scores = recent.flatMap((e) =>
    e.answers.map((a) => a.score).filter((x): x is number => x !== undefined),
  );
  const confidences = recent.flatMap((e) =>
    e.answers.map((a) => a.confidence).filter((x): x is number => x !== undefined),
  );
  const latencies = recent.filter((e) => !e.unjudged).map((e) => e.latency_ms);
  const tokens = recent.reduce((n, e) => n + (e.usage?.input_tokens ?? 0), 0);
  const kept = taps
    .map((e) => /kept (\d+) of (\d+)/.exec(e.decision))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]) / Math.max(1, Number(m[2])));
  const labelled = recent.filter((e) => e.label);
  const precision = (subset: JudgeLogEntry[]) => {
    const l = subset.filter((e) => e.label);
    if (l.length === 0) return 'no labels';
    const right = l.filter((e) => e.label === 'right').length;
    return `${right}/${l.length} right (${((right / l.length) * 100).toFixed(0)}%)`;
  };
  const band = (e: JudgeLogEntry) => {
    const top = e.answers.reduce<{ score?: number; confidence?: number } | null>(
      (best, a) => (a.score !== undefined && (best?.score ?? -1) < a.score ? a : best),
      null,
    );
    if (!top || top.score === undefined) return 'n/a';
    const c = top.confidence ?? 0;
    return `${top.score >= 1.5 ? '1.5+' : top.score >= 1 ? '1-1.5' : '<1'} / conf ${c >= 0.8 ? '0.8+' : c >= 0.6 ? '0.6-0.8' : '<0.6'}`;
  };
  const byBand = new Map<string, JudgeLogEntry[]>();
  for (const e of labelled) {
    const b = band(e);
    byBand.set(b, [...(byBand.get(b) ?? []), e]);
  }
  const opened = taps.filter((e) => e.opened && e.opened.length > 0);
  const openedTop = opened.filter((e) => {
    const top = e.answers.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    return top?.file !== undefined && (e.opened ?? []).includes(top.file);
  });
  const lines = [
    `judge report, last ${days} day(s), ${recent.length} calls (${judgeLogPath()})`,
    `scribe: ${creates.length} judged, ${refused.length} refused, ${forcedAfter.length} forced through, ${uncertain.length} covered-but-uncertain`,
    `tap: ${taps.length} judged, mean kept ${kept.length ? ((kept.reduce((a, b) => a + b, 0) / kept.length) * 100).toFixed(0) : '-'}% of fetched hits`,
    `unjudged: ${unjudged.length} (${[...new Set(unjudged.map((e) => e.unjudged))].join(', ') || 'none'})`,
    `scores: ${histogram(scores, [0.5, 1.0, 1.5, 2.0])}`,
    `confidence: ${histogram(confidences, [0.4, 0.6, 0.8, 1.0])}`,
    `latency: p50 ${percentile(latencies, 0.5)} ms, p95 ${percentile(latencies, 0.95)} ms`,
    `input tokens: ${tokens}`,
    `labels: ${labelled.length} of ${recent.length} reviewed; refusals ${precision(refused)}; uncertain ${precision(uncertain)}; recall ${precision(taps)}`,
    ...[...byBand.entries()].map(([b, es]) => `  ${b}: ${precision(es)}`),
    `opened after recall: ${opened.length} taps, top judged hit opened in ${openedTop.length}`,
  ];
  return lines.join('\n');
}

export async function judgeReportCmd(opts: { days?: number }): Promise<void> {
  const entries = await readJudgeLog();
  process.stdout.write(`${renderJudgeReport(entries, opts.days ?? 7)}\n`);
}

function describeEntry(e: JudgeLogEntry): string {
  const lines = [
    `${e.ts.slice(0, 16)}  ${e.command}  ${e.decision}${e.forced ? '  (--force)' : ''}`,
  ];
  if (e.content?.query) lines.push(`  query: ${e.content.query}`);
  if (e.content?.draft) lines.push(`  draft: ${e.content.draft.title}: ${e.content.draft.head}`);
  const byId = new Map(e.answers.map((a) => [a.id, a]));
  for (const c of e.content?.candidates ?? []) {
    const a = byId.get(c.id);
    const score =
      a?.score !== undefined
        ? `${a.score.toFixed(2)}${a.confidence !== undefined ? ` c${a.confidence.toFixed(2)}` : ''}`
        : '-';
    lines.push(`  [${score}] ${c.title}: ${c.head}`);
  }
  if (!e.content) {
    for (const a of e.answers) {
      if (a.score !== undefined) lines.push(`  [${a.score.toFixed(2)}] ${a.file ?? a.id}`);
    }
  }
  if (e.opened?.length) lines.push(`  opened: ${e.opened.join(', ')}`);
  return lines.join('\n');
}

export async function judgeReviewCmd(opts: { limit?: number }): Promise<void> {
  const entries = await readJudgeLog();
  const pending = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !e.label && !e.unjudged)
    .reverse()
    .slice(0, opts.limit ?? 20);
  if (pending.length === 0) {
    log.info('nothing to review');
    return;
  }
  const labels = new Map<number, 'right' | 'wrong'>();
  for (const { e, i } of pending) {
    process.stdout.write(`\n${describeEntry(e)}\n`);
    const answer = await select({
      message: 'Was the judge right?',
      options: [
        { value: 'right', label: 'right' },
        { value: 'wrong', label: 'wrong' },
        { value: 'skip', label: 'skip' },
        { value: 'stop', label: 'stop' },
      ],
    });
    if (isCancel(answer) || answer === 'stop') break;
    if (answer === 'right' || answer === 'wrong') labels.set(i, answer);
  }
  const changed = await updateJudgeLog((e, i) => {
    const label = labels.get(i);
    return label ? { ...e, label } : e;
  });
  log.success(`${changed} label(s) saved`);
}
