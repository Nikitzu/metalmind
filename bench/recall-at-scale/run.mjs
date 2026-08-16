#!/usr/bin/env node
// recall-at-scale runner.
//
// Mirrors bench/recall-v0/run.mjs lifecycle (per-scale isolated tmp vault,
// dedicated watcher on isolated port, indexer one-shot, query, teardown) but
// drops the bm25/qmd comparison columns. Just metalmind hybrid + optional
// rerank, against synthetic HN-comment vaults at 1k/10k/50k.
//
// Prereqs: run scripts/fetch-hn.mjs --n 50000 first; questions.json must
// exist (run scripts/seed-gold.mjs).
//
// Isolation env vars:
//   VAULT_PATH          tmp vault root (gold + N-20 fillers)
//   VAULT_COLLECTION    metalmind_bench_recall_at_scale_<scale>
//   VAULT_HTTP_PORT     METALMIND_BENCH_PORT (default 17500)

import { spawn } from 'node:child_process';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBuildUnderTest } from '../lib/build-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = join(HERE, 'questions.json');
const RESULTS_DIR = join(HERE, 'results');
const DEFAULT_CACHE = join(homedir(), '.cache', 'metalmind-bench', 'hn');
const DEFAULT_PORT = 17500;
const COLLECTION_PREFIX = 'metalmind_bench_recall_at_scale';

const K = Number(process.env.METALMIND_BENCH_K ?? 5);
const RERANK = process.argv.includes('--rerank') || process.env.METALMIND_BENCH_RERANK === '1';
const ANY_BUILD = process.argv.includes('--any-build');
const TIMEOUT_MS = RERANK ? 300_000 : 30_000;
const QDRANT_URL = process.env.VAULT_QDRANT_URL ?? 'http://localhost:6333';

function parseArgs(argv) {
  const out = {
    scales: [1000, 10000, 50000],
    cache: DEFAULT_CACHE,
    port: DEFAULT_PORT,
    indexTimeoutMs: 4 * 60 * 60_000,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--scales')
      out.scales = argv[++i]
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 1);
    else if (a === '--cache') out.cache = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--rerank') {
      // already captured
    } else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'usage: run.mjs [--scales 1000,10000,50000] [--cache <dir>] [--port 17500] [--rerank]\n',
      );
      process.exit(0);
    }
  }
  return out;
}

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
      process.stderr.write(`teardown error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}
async function teardownAndExit(code) {
  await runTeardowns();
  process.exit(code);
}
process.on('SIGINT', () => teardownAndExit(130));
process.on('SIGTERM', () => teardownAndExit(143));
process.on('uncaughtException', async (err) => {
  process.stderr.write(`uncaught: ${err.stack ?? err}\n`);
  await teardownAndExit(2);
});

async function searchOnce(endpoint, query) {
  const body = { query, k: K, mode: 'hybrid', rerank: RERANK };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(`${endpoint}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`search ${res.status}`);
    const json = await res.json();
    return { hits: json.hits ?? json.results ?? [], elapsedMs: performance.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

async function waitForHttp(endpoint, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${endpoint}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'ping', k: 1 }),
      });
      if (res.ok || res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function dropCollection(name) {
  if (process.env.METALMIND_BACKEND === 'legacy') {
    try {
      await fetch(`${QDRANT_URL}/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
    } catch {
      // Qdrant unreachable; nothing to drop
    }
  }
}

function runOnce(cmd, env, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const buf = [];
    child.stdout.on('data', (d) => buf.push(d.toString()));
    child.stderr.on('data', (d) => buf.push(d.toString()));
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms\n${buf.join('').slice(-2000)}`));
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(buf.join(''));
      else reject(new Error(`${cmd} exit ${code}\n${buf.join('').slice(-2000)}`));
    });
    child.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

/**
 * Expand each question's gold set to every cached note sharing its story.
 *
 * questions.json freezes `expected` at seed time, but the vault contains
 * every cached comment. Any comment on the gold story answers "discussion
 * of <title>" just as well as the one that got listed, so at large scales
 * an unlisted sibling outranks a listed one and the run scores a near-miss
 * for a correct answer. Deriving the set from story_id at run time keeps
 * hit@1 meaning the same thing at 1k and 50k.
 */
async function expandExpectedByStory(questions, cache) {
  const files = (await readdir(cache)).filter((f) => f.endsWith('.md'));
  const byStory = new Map();
  for (const f of files) {
    const head = (await readFile(join(cache, f), 'utf8')).slice(0, 500);
    const m = head.match(/story_id:\s*"?(\d+)"?/);
    if (!m) continue;
    const list = byStory.get(m[1]) ?? [];
    list.push(f);
    byStory.set(m[1], list);
  }

  return questions.map((q) => {
    const tag = (q.tags ?? []).find((t) => String(t).startsWith('story:'));
    const story = tag ? String(tag).slice('story:'.length) : null;
    const siblings = story ? (byStory.get(story) ?? []) : [];
    const expected = [...new Set([...(q.expected ?? []), ...siblings])];
    return { ...q, expected, expectedLabelled: (q.expected ?? []).length };
  });
}

async function assembleVault(vault, scale, cache, expectedFiles) {
  await mkdir(vault, { recursive: true });
  const cacheFiles = (await readdir(cache)).filter((f) => f.endsWith('.md'));
  const cacheSet = new Set(cacheFiles);

  for (const f of expectedFiles) {
    if (!cacheSet.has(f)) throw new Error(`gold file missing from cache: ${f}`);
    await copyFile(join(cache, f), join(vault, f));
  }

  const expectedSet = new Set(expectedFiles);
  const fillerNeeded = Math.max(0, scale - expectedFiles.length);
  let copied = 0;
  for (const f of cacheFiles.sort()) {
    if (copied >= fillerNeeded) break;
    if (expectedSet.has(f)) continue;
    await copyFile(join(cache, f), join(vault, f));
    copied += 1;
  }
  if (copied < fillerNeeded) {
    throw new Error(
      `cache has ${cacheFiles.length} notes; need ${scale} (${fillerNeeded} fillers + ${expectedFiles.length} gold). ` +
      `Run fetch-hn.mjs with a larger --n.`,
    );
  }
}

async function runScale(scale, port, questions, cache) {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'metalmind-bench-recall-at-scale-'));
  const vault = join(tmpRoot, 'vault');
  registerTeardown(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  const expected = [...new Set(questions.flatMap((q) => q.expected))];
  process.stdout.write(`[scale=${scale}] assembling vault…\n`);
  await assembleVault(vault, scale, cache, expected);

  const collection = `${COLLECTION_PREFIX}_${scale}`;
  registerTeardown(() => dropCollection(collection));

  const env = {
    ...process.env,
    VAULT_PATH: vault,
    VAULT_COLLECTION: collection,
    VAULT_HTTP_PORT: String(port),
  };

  const indexStart = performance.now();
  process.stdout.write(`[scale=${scale}] indexing…\n`);
  await runOnce('metalmind-vault-rag-indexer', env, tmpRoot, 4 * 60 * 60_000);
  const indexElapsedSec = (performance.now() - indexStart) / 1000;
  process.stdout.write(`[scale=${scale}] indexed in ${indexElapsedSec.toFixed(1)}s\n`);

  const indexBytes = await measureIndexBytes(collection);
  process.stdout.write(`[scale=${scale}] index size ${(indexBytes.total / 1e6).toFixed(1)} MB (fts ${(indexBytes.fts / 1e6).toFixed(1)} + vec ${(indexBytes.vec / 1e6).toFixed(1)})\n`);

  process.stdout.write(`[scale=${scale}] starting watcher on port ${port}…\n`);
  const watcher = spawn('metalmind-vault-rag-watcher', [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  watcher.stdout.on('data', (d) => logs.push(d.toString()));
  watcher.stderr.on('data', (d) => logs.push(d.toString()));
  const watcherLog = join(tmpRoot, 'watcher.log');
  registerTeardown(async () => {
    if (!watcher.killed) {
      watcher.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (!watcher.killed) watcher.kill('SIGKILL');
    }
    await writeFile(watcherLog, logs.join(''), 'utf8').catch(() => undefined);
  });

  const endpoint = `http://127.0.0.1:${port}`;
  const up = await waitForHttp(endpoint, 60_000);
  if (!up) {
    throw new Error(
      `[scale=${scale}] watcher HTTP did not come up on ${endpoint} within 60s. log tail:\n${logs.join('').slice(-1500)}`,
    );
  }

  await assertBuildUnderTest(endpoint, { allowAny: ANY_BUILD });

  if (RERANK) {
    try {
      const res = await fetch(`${endpoint}/rerank/status`);
      if (res.ok && (await res.json()).available) {
        process.stdout.write(`[scale=${scale}] rerank=engaged\n`);
      } else {
        process.stdout.write(
          `[scale=${scale}] rerank=DISABLED - install metalmind-vault-rag[rerank] in the watcher venv.\n`,
        );
      }
    } catch {
      process.stdout.write(`[scale=${scale}] rerank status unknown\n`);
    }
  }

  // Warm the cache once with a lightweight call
  await searchOnce(endpoint, questions[0].query).catch(() => undefined);

  const perQ = [];
  for (const q of questions) {
    const t0 = performance.now();
    const { hits, elapsedMs } = await searchOnce(endpoint, q.query);
    perQ.push({
      id: q.id,
      query: q.query,
      expected: q.expected,
      rank: hitRank(hits, q.expected),
      ndcg: ndcgAt(hits, q.expected, K),
      latencyMs: elapsedMs,
      topBasename: hits[0] ? basenameOfHit(hits[0]) : null,
    });
    process.stdout.write(
      `[scale=${scale}] ${q.id} rank=${perQ[perQ.length - 1].rank ?? 'miss'} t=${elapsedMs.toFixed(0)}ms\n`,
    );
  }

  const probeName = questions[0].expected[0];
  const probePath = join(vault, probeName);
  await appendFile(probePath, `\nbench incremental-reindex probe ${Date.now()}\n`, 'utf8');
  const reindexStart = performance.now();
  const reindexRes = await fetch(`${endpoint}/reindex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: [probePath] }),
  });
  const incrementalReindexMs = performance.now() - reindexStart;
  if (!reindexRes.ok) {
    throw new Error(`[scale=${scale}] /reindex probe failed: HTTP ${reindexRes.status}`);
  }
  process.stdout.write(`[scale=${scale}] 1-file reindex ${incrementalReindexMs.toFixed(0)}ms\n`);

  await runTeardowns();

  return {
    scale,
    indexElapsedSec,
    indexBytes,
    incrementalReindexMs,
    perQ,
    summary: summarize(perQ),
  };
}

async function measureIndexBytes(collection) {
  const ftsDb =
    process.env.VAULT_FTS_DB_PATH ?? join(homedir(), '.metalmind', `fts-${collection}.db`);
  const vecDb =
    process.env.VAULT_VEC_DB_PATH ?? join(homedir(), '.metalmind', `vec-${collection}.db`);
  const size = async (p) => (await stat(p).catch(() => null))?.size ?? 0;
  const fts = await size(ftsDb);
  const vec = await size(vecDb);
  return { fts, vec, total: fts + vec };
}

function basenameOfHit(hit) {
  if (hit.file) return String(hit.file).split('/').pop();
  if (hit.basename) return hit.basename;
  if (hit.path) return String(hit.path).split('/').pop();
  return null;
}

function hitRank(hits, expectedBasenames) {
  for (let i = 0; i < hits.length; i += 1) {
    const b = basenameOfHit(hits[i]);
    if (b && expectedBasenames.includes(b)) return i + 1;
  }
  return null;
}

function rateAt(perQ, k) {
  const n = perQ.length;
  const within = perQ.filter((r) => r.rank !== null && r.rank <= k).length;
  return n === 0 ? 0 : within / n;
}

function meanReciprocalRank(ranks) {
  if (ranks.length === 0) return 0;
  return ranks.reduce((acc, r) => acc + (r ? 1 / r : 0), 0) / ranks.length;
}

function ndcgAt(hits, expectedBasenames, k) {
  const seen = new Set();
  let dcg = 0;
  for (let i = 0; i < Math.min(hits.length, k); i += 1) {
    const b = basenameOfHit(hits[i]);
    if (b && expectedBasenames.includes(b) && !seen.has(b)) {
      seen.add(b);
      dcg += 1 / Math.log2(i + 2);
    }
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(expectedBasenames.length, k); i += 1) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

function summarize(perQ) {
  const lat = perQ.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    n: perQ.length,
    hitAt1: rateAt(perQ, 1),
    hitAt3: rateAt(perQ, 3),
    hitAt5: rateAt(perQ, 5),
    mrr: meanReciprocalRank(perQ.map((r) => r.rank)),
    ndcgAt5: perQ.length === 0 ? 0 : perQ.reduce((acc, r) => acc + (r.ndcg ?? 0), 0) / perQ.length,
    misses: perQ.filter((r) => r.rank === null).length,
    p50ms: percentile(lat, 50),
    p95ms: percentile(lat, 95),
  };
}

function pct(x) {
  return `${(x * 100).toFixed(0)}%`;
}

function renderMd({ meta, perScale }) {
  const lines = [];
  lines.push(`# recall-at-scale results`);
  lines.push('');
  lines.push(`- date: ${meta.timestamp}`);
  lines.push(`- rerank: ${meta.rerank ? 'on' : 'off'}`);
  lines.push(`- backend: ${meta.backend}`);
  lines.push(`- corpus: HN comments via Algolia (cache=${meta.cache})`);
  lines.push('');
  lines.push(
    '| scale | hit@1 | hit@3 | hit@5 | MRR | NDCG@5 | misses | index (s) | index (MB) | 1-file reindex (ms) | p50 (ms) | p95 (ms) |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of perScale) {
    lines.push(
      `| ${r.scale} | ${pct(r.summary.hitAt1)} | ${pct(r.summary.hitAt3)} | ${pct(r.summary.hitAt5)} | ${r.summary.mrr.toFixed(2)} | ${r.summary.ndcgAt5.toFixed(2)} | ${r.summary.misses}/${r.summary.n} | ${r.indexElapsedSec.toFixed(1)} | ${(r.indexBytes.total / 1e6).toFixed(1)} | ${r.incrementalReindexMs.toFixed(0)} | ${r.summary.p50ms.toFixed(0)} | ${r.summary.p95ms.toFixed(0)} |`,
    );
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv);
  const seeded = JSON.parse(await readFile(QUESTIONS_PATH, 'utf8'));
  const questions = await expandExpectedByStory(seeded, args.cache);
  const labelled = questions.reduce((n, q) => n + q.expectedLabelled, 0);
  const expanded = questions.reduce((n, q) => n + q.expected.length, 0);
  process.stdout.write(
    `loaded ${questions.length} questions; gold ${labelled} seeded -> ${expanded} after story expansion; ` +
      `scales=${args.scales.join(',')}; rerank=${RERANK}\n`,
  );

  const perScale = [];
  for (let i = 0; i < args.scales.length; i += 1) {
    const scale = args.scales[i];
    const port = args.port + i;
    const result = await runScale(scale, port, questions, args.cache);
    perScale.push(result);
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const meta = {
    timestamp: new Date().toISOString(),
    rerank: RERANK,
    backend: process.env.METALMIND_BACKEND ?? 'embedded',
    cache: args.cache,
  };
  const outJson = join(RESULTS_DIR, `recall-at-scale-${stamp}.json`);
  const outMd = join(RESULTS_DIR, `recall-at-scale-${stamp}.md`);
  await writeFile(outJson, JSON.stringify({ meta, perScale }, null, 2) + '\n');
  await writeFile(outMd, renderMd({ meta, perScale }));
  process.stdout.write(`\nwrote ${outMd}\n`);
  process.stdout.write(renderMd({ meta, perScale }));

  const minHit5 = Math.min(...perScale.map((r) => r.summary.hitAt5));
  const gate = 0.4;
  if (minHit5 < gate) {
    process.stderr.write(`FAIL: min hit@5 across scales = ${pct(minHit5)} < ${pct(gate)}\n`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  process.stderr.write(`run failed: ${err.stack ?? err}\n`);
  await runTeardowns();
  process.exit(1);
});
