import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '@clack/prompts';
import { type RecallMode, type RecallTier, recall } from '../backends/recall.js';
import { listRecentNotes } from '../backends/vault-browse.js';
import { readConfig } from '../config.js';
import { judge as judgeCall, judgeEnabled } from '../judge/client.js';
import { appendJudgeLog, entryFromResult, head } from '../judge/log.js';
import { formatJudgedTail, JUDGED_FETCH_K, judgeHits } from '../judge/rerank.js';

export interface TapOptions {
  deep?: boolean;
  expand?: boolean;
  semanticOnly?: boolean;
  keywordOnly?: boolean;
  k?: number;
  json?: boolean;
  compact?: boolean;
  files?: boolean;
  budget?: number;
  neighbors?: boolean;
  verbose?: boolean;
  listRecent?: number;
  verifyCode?: boolean;
  noJudge?: boolean;
}

function resolveMode(opts: TapOptions): RecallMode {
  if (opts.semanticOnly) return 'semantic-only';
  if (opts.keywordOnly) return 'keyword-only';
  return 'hybrid';
}

function resolveTier(opts: TapOptions, defaultTier: RecallTier): RecallTier {
  if (opts.expand) return 'expand';
  if (opts.deep) return 'deep';
  return defaultTier;
}

export async function tap(query: string | undefined, opts: TapOptions = {}): Promise<void> {
  const config = await readConfig();
  if (!config) {
    log.error('No metalmind config. Run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }

  if (opts.listRecent !== undefined) {
    const notes = await listRecentNotes(config.vaultPath, opts.listRecent);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(notes, null, 2)}\n`);
      return;
    }
    for (const n of notes) {
      const iso = new Date(n.modifiedMs).toISOString().slice(0, 10);
      process.stdout.write(`\n${iso}  ${n.relPath}\n  ${n.title}\n`);
      if (n.excerpt) process.stdout.write(`  ${n.excerpt}\n`);
    }
    return;
  }

  if (opts.semanticOnly && opts.keywordOnly) {
    log.error('--semantic-only and --keyword-only are mutually exclusive.');
    process.exitCode = 1;
    return;
  }

  if (opts.budget !== undefined && (!Number.isInteger(opts.budget) || opts.budget <= 0)) {
    log.error('--budget takes a positive integer token count.');
    process.exitCode = 1;
    return;
  }

  if (!query?.trim()) {
    log.error('Usage: metalmind tap copper "<query>"  |  metalmind tap copper --list-recent N');
    process.exitCode = 1;
    return;
  }

  const tier = resolveTier(opts, config.recall.defaultTier);
  const showMeta = opts.verbose ?? config.verbose;
  const judged = judgeEnabled(config.judge) && !opts.noJudge && tier !== 'expand';
  const k = opts.k ?? 5;
  const judgeHook = judged
    ? async (hits: Array<Record<string, unknown>>) => {
        const r = await judgeHits({
          query,
          hits,
          k,
          judge: ({ state, questions }) =>
            judgeCall({ state, questions, model: config.judge.model }),
          readNote: (file) => readFile(join(config.vaultPath, file), 'utf8'),
        });
        const files = Object.fromEntries(
          hits.map((h, i) => [`h${i}`, typeof h.file === 'string' ? h.file : undefined]),
        );
        const merged = {
          answers: r.results.some((x) => x.answers)
            ? Object.assign({}, ...r.results.map((x) => x.answers ?? {}))
            : null,
          unjudged: r.results.find((x) => x.unjudged)?.unjudged,
          status: r.results.find((x) => x.status)?.status,
          usage: r.results.reduce(
            (acc, x) =>
              x.usage
                ? {
                    input_tokens: acc.input_tokens + x.usage.input_tokens,
                    output_tokens: acc.output_tokens + x.usage.output_tokens,
                  }
                : acc,
            { input_tokens: 0, output_tokens: 0 },
          ),
        };
        await appendJudgeLog({
          ...entryFromResult(
            {
              command: 'tap',
              model: config.judge.model,
              latency_ms: r.latency_ms,
              decision: r.judged ? `kept ${r.kept} of ${r.total}` : 'unjudged',
            },
            merged,
            files,
          ),
          ...(config.judge.logContent
            ? {
                content: {
                  query,
                  candidates: hits.map((h, i) => ({
                    id: `h${i}`,
                    title: typeof h.file === 'string' ? h.file : '',
                    head: head(String(h.text ?? '')),
                  })),
                },
              }
            : {}),
        });
        return { hits: r.hits, tail: r.judged ? formatJudgedTail(r) : (r.unjudgedLine ?? '') };
      }
    : undefined;

  try {
    const result = await recall({
      vaultPath: config.vaultPath,
      query,
      tier,
      k: judged ? Math.max(k, JUDGED_FETCH_K) : opts.k,
      judgeHits: judgeHook,
      mode: resolveMode(opts),
      verbose: showMeta,
      compact: opts.compact,
      files: opts.files,
      budgetTokens: opts.budget,
      neighbors: opts.neighbors,
      verifyCode: opts.verifyCode,
      forgeGroups: config.forge.groups,
      httpEndpoint: config.recall.httpEndpoint,
    });
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ tier, query, judged, text: result.text, hits: result.hits, raw: result.raw }, null, 2)}\n`,
      );
      return;
    }
    if (showMeta) log.info(`${tier} (${query.length} chars)`);
    if (
      opts.neighbors &&
      result.transport === 'http' &&
      result.hits &&
      result.hits.length > 0 &&
      !result.hits.some((h) => h.neighbor_text)
    ) {
      log.info(
        'no neighbor context returned - hits are single-chunk notes, or the watcher predates --neighbors (restart it after updating)',
      );
    }
    if (opts.neighbors && result.transport === 'stdio') {
      log.info('--neighbors needs the HTTP recall path; stdio fallback returned plain hits.');
    }
    process.stdout.write(`${result.text}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`tap failed: ${message}`);
    process.exitCode = 1;
  }
}
