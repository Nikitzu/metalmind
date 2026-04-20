#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = join(HERE, 'questions.json');
const RESULTS_DIR = join(HERE, 'results');

const ENDPOINT =
  process.env.METALMIND_BENCH_ENDPOINT ??
  process.env.METALMIND_RECALL_HTTP ??
  'http://127.0.0.1:17317';
const K = Number(process.env.METALMIND_BENCH_K ?? 5);
const TIMEOUT_MS = Number(process.env.METALMIND_BENCH_TIMEOUT_MS ?? 8000);

async function searchOnce(query, k) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(`${ENDPOINT}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, k }),
      signal: controller.signal,
    });
    const latencyMs = performance.now() - t0;
    if (!res.ok) {
      return { ok: false, status: res.status, latencyMs, hits: [] };
    }
    const body = await res.json();
    return { ok: true, latencyMs, hits: Array.isArray(body.hits) ? body.hits : [] };
  } catch (err) {
    const latencyMs = performance.now() - t0;
    return { ok: false, latencyMs, error: err instanceof Error ? err.message : String(err), hits: [] };
  } finally {
    clearTimeout(timer);
  }
}

function hitRank(hits, expectedBasenames) {
  for (let i = 0; i < hits.length; i += 1) {
    const file = hits[i]?.file;
    if (typeof file !== 'string') continue;
    const base = basename(file);
    if (expectedBasenames.includes(base)) return i + 1;
  }
  return null;
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

function summarize(perQ) {
  const latencies = perQ.map((r) => r.latencyMs).sort((a, b) => a - b);
  const hitAt1 = perQ.filter((r) => r.rank !== null && r.rank <= 1).length;
  const hitAt3 = perQ.filter((r) => r.rank !== null && r.rank <= 3).length;
  const hitAt5 = perQ.filter((r) => r.rank !== null && r.rank <= 5).length;
  const total = perQ.length;
  return {
    total,
    hitAt1: { count: hitAt1, rate: hitAt1 / total },
    hitAt3: { count: hitAt3, rate: hitAt3 / total },
    hitAt5: { count: hitAt5, rate: hitAt5 / total },
    latencyMs: {
      min: latencies[0] ?? 0,
      median: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies[latencies.length - 1] ?? 0,
    },
  };
}

function renderMarkdown({ meta, summary, perQ }) {
  const lines = [];
  lines.push(`# recall-v0 bench — ${meta.ts}`);
  lines.push('');
  lines.push(`- endpoint: \`${meta.endpoint}\``);
  lines.push(`- k: ${meta.k}`);
  lines.push(`- vault: ${meta.vault ?? '(unknown — set METALMIND_BENCH_VAULT)'}`);
  lines.push(`- questions: ${summary.total}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| metric | value |');
  lines.push('| --- | --- |');
  lines.push(`| hit@1 | ${summary.hitAt1.count}/${summary.total} (${(summary.hitAt1.rate * 100).toFixed(1)}%) |`);
  lines.push(`| hit@3 | ${summary.hitAt3.count}/${summary.total} (${(summary.hitAt3.rate * 100).toFixed(1)}%) |`);
  lines.push(`| hit@5 | ${summary.hitAt5.count}/${summary.total} (${(summary.hitAt5.rate * 100).toFixed(1)}%) |`);
  lines.push(`| latency min | ${summary.latencyMs.min.toFixed(1)} ms |`);
  lines.push(`| latency median | ${summary.latencyMs.median.toFixed(1)} ms |`);
  lines.push(`| latency p95 | ${summary.latencyMs.p95.toFixed(1)} ms |`);
  lines.push(`| latency max | ${summary.latencyMs.max.toFixed(1)} ms |`);
  lines.push('');
  lines.push('## Per-question');
  lines.push('');
  lines.push('| id | query | expected | rank | latency (ms) | ok |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of perQ) {
    lines.push(
      `| ${r.id} | ${r.query} | ${r.expected.join(', ')} | ${r.rank ?? '—'} | ${r.latencyMs.toFixed(1)} | ${r.ok ? 'y' : 'n'} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const raw = await readFile(QUESTIONS_PATH, 'utf8');
  const questions = JSON.parse(raw);

  const perQ = [];
  for (const q of questions) {
    const result = await searchOnce(q.query, K);
    const rank = hitRank(result.hits, q.expected);
    perQ.push({
      id: q.id,
      query: q.query,
      expected: q.expected,
      tags: q.tags ?? [],
      ok: result.ok,
      latencyMs: result.latencyMs,
      rank,
      topHits: result.hits.slice(0, K).map((h) => ({
        file: typeof h.file === 'string' ? h.file : null,
        score: typeof h.score === 'number' ? h.score : null,
      })),
      error: result.error,
    });
    const mark = rank ? `hit@${rank}` : 'MISS';
    process.stdout.write(`${q.id} ${mark.padEnd(7)} ${result.latencyMs.toFixed(0)}ms  ${q.query}\n`);
  }

  const summary = summarize(perQ);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const meta = {
    ts,
    endpoint: ENDPOINT,
    k: K,
    vault: process.env.METALMIND_BENCH_VAULT ?? null,
    questionsSha1: createHash('sha1').update(raw).digest('hex').slice(0, 10),
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const jsonPath = join(RESULTS_DIR, `${ts}.json`);
  const mdPath = join(RESULTS_DIR, `${ts}.md`);
  await writeFile(jsonPath, `${JSON.stringify({ meta, summary, perQ }, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, renderMarkdown({ meta, summary, perQ }), 'utf8');

  process.stdout.write(`\nResults:\n  ${jsonPath}\n  ${mdPath}\n\n`);
  process.stdout.write(
    `hit@1=${(summary.hitAt1.rate * 100).toFixed(1)}%  hit@3=${(summary.hitAt3.rate * 100).toFixed(1)}%  hit@5=${(summary.hitAt5.rate * 100).toFixed(1)}%  median=${summary.latencyMs.median.toFixed(0)}ms  p95=${summary.latencyMs.p95.toFixed(0)}ms\n`,
  );

  if (summary.hitAt5.rate < 0.6) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`bench failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(2);
});
