#!/usr/bin/env node
// recall-v0 runner.
//
// Two modes:
//
//   1. Single-scale (default, backward-compatible). Talks to whatever watcher
//      is running on METALMIND_RECALL_HTTP / METALMIND_BENCH_ENDPOINT. Runs the
//      20 questions once, writes one results file. Caller owns the watcher.
//
//   2. Multi-scale (--scales 12,100,500,1000). Runner owns the lifecycle:
//      for each scale N, assembles an isolated tmp vault (12 gold + first N
//      distractors), spawns a dedicated watcher on an isolated port and
//      Qdrant collection, indexes, queries, tears down. Signal-safe teardown:
//      watcher killed, Qdrant collection dropped, tmp vault removed even on
//      crash / Ctrl-C.
//
// Isolation env vars (multi-scale mode):
//   VAULT_PATH          = tmp vault root
//   VAULT_COLLECTION    = metalmind_bench_recall_v0_<scale>   (per-scale, dropped on teardown)
//   VAULT_HTTP_PORT     = METALMIND_BENCH_PORT (default 17400) — does not collide with user watcher at 17317
//   VAULT_QDRANT_URL    = passed through from user env (defaults to localhost:6333)

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScorer as buildBm25Scorer } from './scripts/bm25.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = join(HERE, 'questions.json');
const GOLD_DIR = join(HERE, 'fake-vault');
const DISTRACTORS_DIR = join(HERE, 'fake-vault-distractors');
const RESULTS_DIR = join(HERE, 'results');

const DEFAULT_PORT = 17400;
const COLLECTION_PREFIX = 'metalmind_bench_recall_v0';
const QDRANT_URL = process.env.VAULT_QDRANT_URL ?? 'http://localhost:6333';

const K = Number(process.env.METALMIND_BENCH_K ?? 5);
const TIMEOUT_MS = Number(process.env.METALMIND_BENCH_TIMEOUT_MS ?? 8000);
const RERANK = process.argv.includes('--rerank') || process.env.METALMIND_BENCH_RERANK === '1';
const EFFECTIVE_TIMEOUT_MS = RERANK ? Math.max(TIMEOUT_MS, 180_000) : TIMEOUT_MS;

// -----------------------------------------------------------------------------
// CLI args
// -----------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { scales: null, port: DEFAULT_PORT };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--scale' || a === '--scales') {
      out.scales = argv[++i]
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0);
    } else if (a === '--port') {
      out.port = Number(argv[++i]);
    } else if (a === '--rerank') {
      // handled via RERANK global
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Teardown registry — ensures cleanup on normal exit, signal, or crash.
// -----------------------------------------------------------------------------

const teardowns = [];

function registerTeardown(fn) {
  teardowns.push(fn);
}

async function runTeardowns() {
  while (teardowns.length) {
    const fn = teardowns.pop();
    try {
      await fn();
    } catch (err) {
      process.stderr.write(
        `teardown error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

let tearingDown = false;
async function teardownAndExit(code) {
  if (tearingDown) return;
  tearingDown = true;
  await runTeardowns();
  process.exit(code);
}

process.on('SIGINT', () => teardownAndExit(130));
process.on('SIGTERM', () => teardownAndExit(143));
process.on('uncaughtException', async (err) => {
  process.stderr.write(`uncaught: ${err.stack ?? String(err)}\n`);
  await teardownAndExit(2);
});

// -----------------------------------------------------------------------------
// HTTP helpers
// -----------------------------------------------------------------------------

async function searchOnce(endpoint, query, k, mode = 'hybrid', rerank = false) {
  const controller = new AbortController();
  const timeout = rerank ? Math.max(TIMEOUT_MS, 180_000) : TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);
  const t0 = performance.now();
  try {
    const res = await fetch(`${endpoint}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, k, mode, rerank }),
      signal: controller.signal,
    });
    const latencyMs = performance.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, latencyMs, hits: [] };
    const body = await res.json();
    return { ok: true, latencyMs, hits: Array.isArray(body.hits) ? body.hits : [] };
  } catch (err) {
    const latencyMs = performance.now() - t0;
    return {
      ok: false,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
      hits: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHttp(endpoint, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${endpoint}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'ping', k: 1 }),
      });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function dropCollection(name) {
  try {
    await fetch(`${QDRANT_URL}/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
  } catch {
    // qdrant may be gone; nothing to do
  }
}

// -----------------------------------------------------------------------------
// Scale run: assemble tmp vault, spawn watcher, index, query, teardown.
// -----------------------------------------------------------------------------

async function runScale(scale, port, questions) {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'metalmind-bench-recall-v0-'));
  const vault = join(tmpRoot, 'vault');
  await mkdir(vault, { recursive: true });
  registerTeardown(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // Copy 12 gold notes
  await cp(GOLD_DIR, vault, { recursive: true });

  // Copy first <scale-12> distractors (naming is distractor-0001..0NNNN sorted)
  const distractorCount = Math.max(0, scale - 12);
  for (let i = 1; i <= distractorCount; i += 1) {
    const name = `distractor-${String(i).padStart(4, '0')}.md`;
    await cp(join(DISTRACTORS_DIR, name), join(vault, name));
  }

  const collection = `${COLLECTION_PREFIX}_${scale}`;
  registerTeardown(() => dropCollection(collection));

  const env = {
    ...process.env,
    VAULT_PATH: vault,
    VAULT_COLLECTION: collection,
    VAULT_HTTP_PORT: String(port),
  };

  // One-shot index first so HTTP serves a populated collection.
  process.stdout.write(`[scale=${scale}] indexing ${scale} notes into ${collection}…\n`);
  await runOnce('metalmind-vault-rag-indexer', env, tmpRoot);

  // Spawn watcher (HTTP server co-hosted) in the background.
  process.stdout.write(`[scale=${scale}] starting watcher on port ${port}…\n`);
  const watcher = spawn('metalmind-vault-rag-watcher', [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const watcherLog = join(tmpRoot, 'watcher.log');
  const logs = [];
  watcher.stdout.on('data', (d) => logs.push(d.toString()));
  watcher.stderr.on('data', (d) => logs.push(d.toString()));
  registerTeardown(async () => {
    if (!watcher.killed) {
      watcher.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (!watcher.killed) watcher.kill('SIGKILL');
    }
    await writeFile(watcherLog, logs.join(''), 'utf8').catch(() => undefined);
  });

  const endpoint = `http://127.0.0.1:${port}`;
  const up = await waitForHttp(endpoint, 30_000);
  if (!up) {
    throw new Error(
      `[scale=${scale}] watcher HTTP did not come up on ${endpoint} within 30s. Port collision? watcher log:\n${logs.join('')}`,
    );
  }

  // Build BM25 scorer over the same tmp vault (in-process, no HTTP).
  // Kept as an independent-implementation sanity check alongside the server's
  // FTS5 BM25 — any large divergence points at a tokenizer bug or stale index.
  const bm25Node = await buildBm25Scorer(vault);

  // Each mode gets its own column. Rerank is an orthogonal flag on hybrid.
  const MODES = [
    { key: 'semanticOnly', mode: 'semantic-only', rerank: false, label: 'sem' },
    { key: 'keywordOnly', mode: 'keyword-only', rerank: false, label: 'key' },
    { key: 'hybrid', mode: 'hybrid', rerank: false, label: 'hyb' },
    { key: 'hybridRerank', mode: 'hybrid', rerank: true, label: 'rr ' },
  ];

  const perQ = [];
  for (const q of questions) {
    const record = {
      id: q.id,
      query: q.query,
      expected: q.expected,
      tags: q.tags ?? [],
    };
    const marks = [];
    let firstOk = true;
    for (const m of MODES) {
      if (!RERANK && m.rerank) {
        record[m.key] = { rank: null, latencyMs: 0, ok: null, skipped: true };
        marks.push(`${m.label}=SKIP`);
        continue;
      }
      const r = await searchOnce(endpoint, q.query, K, m.mode, m.rerank);
      const rank = hitRank(r.hits, q.expected);
      record[m.key] = {
        rank,
        latencyMs: r.latencyMs,
        ok: r.ok,
        topHits: r.hits.slice(0, K).map((h) => ({ file: h.file ?? null, score: h.score ?? null })),
      };
      if (firstOk) {
        record.latencyMs = r.latencyMs;
        firstOk = false;
      }
      marks.push(`${m.label}=${rank ? `h@${rank}` : 'MISS'}`);
    }
    const bmNodeHits = bm25Node(q.query, K);
    record.bm25Node = {
      rank: hitRank(bmNodeHits, q.expected),
      topHits: bmNodeHits,
    };
    marks.push(`bmN=${record.bm25Node.rank ? `h@${record.bm25Node.rank}` : 'MISS'}`);
    perQ.push(record);
    process.stdout.write(`  ${q.id}  ${marks.join('  ')}  ${q.query}\n`);
  }

  return { scale, collection, endpoint, summary: summarizeModes(perQ), perQ };
}

function runOnce(cmd, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', () => undefined);
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr}`));
    });
    child.on('error', reject);
  });
}

// -----------------------------------------------------------------------------
// Scoring + summary
// -----------------------------------------------------------------------------

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

function rateAtNested(perQ, key, k) {
  const hits = perQ.filter((r) => r[key]?.rank && r[key].rank <= k).length;
  return { count: hits, rate: hits / perQ.length };
}

function latencyStats(perQ, key) {
  const lats = perQ
    .map((r) => r[key]?.latencyMs)
    .filter((v) => typeof v === 'number' && v > 0)
    .sort((a, b) => a - b);
  return {
    min: lats[0] ?? 0,
    median: percentile(lats, 50),
    p95: percentile(lats, 95),
    max: lats[lats.length - 1] ?? 0,
  };
}

function rateAt(perQ, field, k) {
  const hits = perQ.filter((r) => r[field] !== null && r[field] !== undefined && r[field] <= k).length;
  return { count: hits, rate: hits / perQ.length };
}

function summarize(perQ) {
  const latencies = perQ.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    total: perQ.length,
    hitAt1: rateAt(perQ, 'rank', 1),
    hitAt3: rateAt(perQ, 'rank', 3),
    hitAt5: rateAt(perQ, 'rank', 5),
    latencyMs: {
      min: latencies[0] ?? 0,
      median: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies[latencies.length - 1] ?? 0,
    },
  };
}

function summarizeModes(perQ) {
  const modeKeys = ['semanticOnly', 'keywordOnly', 'hybrid', 'hybridRerank'];
  const summary = {
    total: perQ.length,
    modes: {},
    bm25Node: {
      hitAt1: {
        count: perQ.filter((r) => r.bm25Node?.rank && r.bm25Node.rank <= 1).length,
        rate: perQ.filter((r) => r.bm25Node?.rank && r.bm25Node.rank <= 1).length / perQ.length,
      },
      hitAt3: {
        count: perQ.filter((r) => r.bm25Node?.rank && r.bm25Node.rank <= 3).length,
        rate: perQ.filter((r) => r.bm25Node?.rank && r.bm25Node.rank <= 3).length / perQ.length,
      },
      hitAt5: {
        count: perQ.filter((r) => r.bm25Node?.rank && r.bm25Node.rank <= 5).length,
        rate: perQ.filter((r) => r.bm25Node?.rank && r.bm25Node.rank <= 5).length / perQ.length,
      },
    },
  };
  for (const k of modeKeys) {
    summary.modes[k] = {
      hitAt1: rateAtNested(perQ, k, 1),
      hitAt3: rateAtNested(perQ, k, 3),
      hitAt5: rateAtNested(perQ, k, 5),
      latencyMs: latencyStats(perQ, k),
    };
  }
  return summary;
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------

function renderSingleScaleMd({ meta, summary, perQ }) {
  const lines = [];
  lines.push(`# recall-v0 bench — ${meta.ts}`);
  lines.push('');
  lines.push(`- endpoint: \`${meta.endpoint}\``);
  lines.push(`- k: ${meta.k}`);
  lines.push(`- rerank: ${meta.rerank ? 'on (--rerank)' : 'off (embedder-only baseline)'}`);
  lines.push(`- vault: ${meta.vault ?? '(unknown — set METALMIND_BENCH_VAULT)'}`);
  lines.push(`- questions: ${summary.total}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| metric | value |');
  lines.push('| --- | --- |');
  lines.push(`| hit@1 | ${summary.hitAt1.count}/${summary.total} (${pct(summary.hitAt1.rate)}) |`);
  lines.push(`| hit@3 | ${summary.hitAt3.count}/${summary.total} (${pct(summary.hitAt3.rate)}) |`);
  lines.push(`| hit@5 | ${summary.hitAt5.count}/${summary.total} (${pct(summary.hitAt5.rate)}) |`);
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

function renderMultiScaleMd({ meta, perScale }) {
  const lines = [];
  lines.push(`# recall-v0 scaled bench — ${meta.ts}`);
  lines.push('');
  lines.push(`- k: ${meta.k}`);
  lines.push(`- rerank column: ${meta.rerank ? 'populated (--rerank passed)' : 'skipped (run with --rerank to populate)'}`);
  lines.push(`- scales: ${perScale.map((s) => s.scale).join(', ')}`);
  lines.push(`- questions: ${perScale[0]?.summary.total ?? 0}`);
  lines.push('');
  lines.push('## hit@5 by mode and scale');
  lines.push('');
  lines.push('| scale | sem-only | keyword-only (FTS5) | hybrid (RRF) | hybrid + rerank | BM25 node-impl (sanity) |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of perScale) {
    const m = s.summary.modes;
    lines.push(
      `| ${s.scale} | ${pct(m.semanticOnly.hitAt5.rate)} | ${pct(m.keywordOnly.hitAt5.rate)} | ${pct(m.hybrid.hitAt5.rate)} | ${meta.rerank ? pct(m.hybridRerank.hitAt5.rate) : '—'} | ${pct(s.summary.bm25Node.hitAt5.rate)} |`,
    );
  }
  lines.push('');
  lines.push('## hit@1 by mode and scale');
  lines.push('');
  lines.push('| scale | sem-only | keyword-only | hybrid | hybrid + rerank | BM25 node |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of perScale) {
    const m = s.summary.modes;
    lines.push(
      `| ${s.scale} | ${pct(m.semanticOnly.hitAt1.rate)} | ${pct(m.keywordOnly.hitAt1.rate)} | ${pct(m.hybrid.hitAt1.rate)} | ${meta.rerank ? pct(m.hybridRerank.hitAt1.rate) : '—'} | ${pct(s.summary.bm25Node.hitAt1.rate)} |`,
    );
  }
  lines.push('');
  lines.push('## latency median by mode and scale (ms)');
  lines.push('');
  lines.push('| scale | sem-only | keyword-only | hybrid | hybrid + rerank |');
  lines.push('| ---: | ---: | ---: | ---: | ---: |');
  for (const s of perScale) {
    const m = s.summary.modes;
    lines.push(
      `| ${s.scale} | ${m.semanticOnly.latencyMs.median.toFixed(0)} | ${m.keywordOnly.latencyMs.median.toFixed(0)} | ${m.hybrid.latencyMs.median.toFixed(0)} | ${meta.rerank ? m.hybridRerank.latencyMs.median.toFixed(0) : '—'} |`,
    );
  }
  lines.push('');
  for (const s of perScale) {
    lines.push(`## scale=${s.scale} per-question ranks`);
    lines.push('');
    lines.push('| id | sem | keyword | hybrid | hybrid+rr | bm25-node | query |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of s.perQ) {
      lines.push(
        `| ${r.id} | ${r.semanticOnly?.rank ?? '—'} | ${r.keywordOnly?.rank ?? '—'} | ${r.hybrid?.rank ?? '—'} | ${r.hybridRerank?.skipped ? 'skip' : (r.hybridRerank?.rank ?? '—')} | ${r.bm25Node?.rank ?? '—'} | ${r.query} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const raw = await readFile(QUESTIONS_PATH, 'utf8');
  const questions = JSON.parse(raw);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(RESULTS_DIR, { recursive: true });

  if (args.scales && args.scales.length > 0) {
    // Multi-scale mode
    const perScale = [];
    for (const scale of args.scales) {
      const result = await runScale(scale, args.port, questions);
      perScale.push(result);
      // Teardown this scale before starting the next (release port + collection).
      await runTeardowns();
    }

    const meta = {
      ts,
      k: K,
      rerank: RERANK,
      scales: args.scales,
      questionsSha1: createHash('sha1').update(raw).digest('hex').slice(0, 10),
    };
    const jsonPath = join(RESULTS_DIR, `${ts}-scaled.json`);
    const mdPath = join(RESULTS_DIR, `${ts}-scaled.md`);
    await writeFile(jsonPath, `${JSON.stringify({ meta, perScale }, null, 2)}\n`, 'utf8');
    await writeFile(mdPath, renderMultiScaleMd({ meta, perScale }), 'utf8');

    process.stdout.write(`\nResults:\n  ${jsonPath}\n  ${mdPath}\n\n`);
    for (const s of perScale) {
      const m = s.summary.modes;
      process.stdout.write(
        `scale=${String(s.scale).padStart(4)}  sem@5=${pct(m.semanticOnly.hitAt5.rate)}  key@5=${pct(m.keywordOnly.hitAt5.rate)}  hyb@5=${pct(m.hybrid.hitAt5.rate)}${meta.rerank ? `  rr@5=${pct(m.hybridRerank.hitAt5.rate)}` : ''}  bmN@5=${pct(s.summary.bm25Node.hitAt5.rate)}\n`,
      );
    }

    // Gate against the hybrid mode (the default that ships) at the largest scale.
    const lastHybrid5 = perScale[perScale.length - 1]?.summary.modes.hybrid.hitAt5.rate ?? 0;
    if (lastHybrid5 < 0.6) process.exitCode = 1;
    return;
  }

  // Single-scale mode (backward compatible): hit existing watcher.
  const endpoint =
    process.env.METALMIND_BENCH_ENDPOINT ??
    process.env.METALMIND_RECALL_HTTP ??
    'http://127.0.0.1:17317';

  const perQ = [];
  for (const q of questions) {
    const result = await searchOnce(endpoint, q.query, K);
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
    process.stdout.write(
      `${q.id} ${mark.padEnd(7)} ${result.latencyMs.toFixed(0)}ms  ${q.query}\n`,
    );
  }

  const summary = summarize(perQ);
  const meta = {
    ts,
    endpoint,
    k: K,
    rerank: RERANK,
    vault: process.env.METALMIND_BENCH_VAULT ?? null,
    questionsSha1: createHash('sha1').update(raw).digest('hex').slice(0, 10),
  };

  const jsonPath = join(RESULTS_DIR, `${ts}.json`);
  const mdPath = join(RESULTS_DIR, `${ts}.md`);
  await writeFile(jsonPath, `${JSON.stringify({ meta, summary, perQ }, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, renderSingleScaleMd({ meta, summary, perQ }), 'utf8');

  process.stdout.write(`\nResults:\n  ${jsonPath}\n  ${mdPath}\n\n`);
  process.stdout.write(
    `hit@1=${pct(summary.hitAt1.rate)}  hit@3=${pct(summary.hitAt3.rate)}  hit@5=${pct(summary.hitAt5.rate)}  median=${summary.latencyMs.median.toFixed(0)}ms  p95=${summary.latencyMs.p95.toFixed(0)}ms\n`,
  );

  if (summary.hitAt5.rate < 0.6) process.exitCode = 1;
}

main()
  .then(async () => {
    await runTeardowns();
  })
  .catch(async (err) => {
    process.stderr.write(`bench failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    await runTeardowns();
    process.exit(2);
  });
