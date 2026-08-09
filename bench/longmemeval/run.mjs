#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(homedir(), '.cache', 'metalmind-bench', 'longmemeval');
const RESULTS_DIR = join(HERE, 'results');
const COLLECTION = 'metalmind_bench_longmemeval';
const K = Number(process.env.METALMIND_BENCH_K ?? 5);

function parseArgs(argv) {
  const args = { port: 17600, oracle: false, limit: 0, scale: 0, indexHours: 12, rerank: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--oracle') args.oracle = true;
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--scale') args.scale = Number(argv[++i]);
    else if (argv[i] === '--index-hours') args.indexHours = Number(argv[++i]);
    else if (argv[i] === '--rerank') args.rerank = true;
  }
  return args;
}

const teardowns = [];
function registerTeardown(fn) {
  teardowns.push(fn);
}
async function runTeardowns() {
  while (teardowns.length > 0) {
    const fn = teardowns.pop();
    await fn().catch(() => undefined);
  }
}

function runOnce(cmd, env, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', () => undefined);
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-1000)}`));
    });
    child.on('error', reject);
  });
}

async function waitForHttp(endpoint, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${endpoint}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function searchOnce(endpoint, query, rerank = false) {
  const t0 = performance.now();
  const res = await fetch(`${endpoint}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, k: K, rerank }),
  });
  const json = await res.json();
  return { hits: json.hits ?? [], elapsedMs: performance.now() - t0 };
}

function basenameOfHit(hit) {
  if (hit.file) return String(hit.file).split('/').pop();
  return null;
}

function hitRank(hits, expected) {
  for (let i = 0; i < hits.length; i += 1) {
    const b = basenameOfHit(hits[i]);
    if (b && expected.includes(b)) return i + 1;
  }
  return null;
}

function ndcgAt(hits, expected, k) {
  const seen = new Set();
  let dcg = 0;
  for (let i = 0; i < Math.min(hits.length, k); i += 1) {
    const b = basenameOfHit(hits[i]);
    if (b && expected.includes(b) && !seen.has(b)) {
      seen.add(b);
      dcg += 1 / Math.log2(i + 2);
    }
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(expected.length, k); i += 1) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

function meanReciprocalRank(ranks) {
  if (ranks.length === 0) return 0;
  return ranks.reduce((acc, r) => acc + (r ? 1 / r : 0), 0) / ranks.length;
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

function rateAt(perQ, k) {
  const n = perQ.length;
  if (n === 0) return 0;
  return perQ.filter((r) => r.rank !== null && r.rank <= k).length / n;
}

function summarizeAnswerable(perQ) {
  const lat = perQ.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    n: perQ.length,
    hitAt1: rateAt(perQ, 1),
    hitAt3: rateAt(perQ, 3),
    hitAt5: rateAt(perQ, 5),
    mrr: meanReciprocalRank(perQ.map((r) => r.rank)),
    ndcgAt5: perQ.length === 0 ? 0 : perQ.reduce((a, r) => a + r.ndcg, 0) / perQ.length,
    misses: perQ.filter((r) => r.rank === null).length,
    p50ms: percentile(lat, 50),
    p95ms: percentile(lat, 95),
  };
}

function scoreAbstention(answerable, abstention) {
  const answerableTops = answerable
    .map((r) => r.topScore)
    .filter((v) => typeof v === 'number')
    .sort((a, b) => a - b);
  const floor = percentile(answerableTops, 5);
  const below = abstention.filter((r) => r.topScore === null || r.topScore < floor).length;
  return {
    n: abstention.length,
    floor,
    correctAbstainRate: abstention.length === 0 ? 0 : below / abstention.length,
    answerableTopP50: percentile(answerableTops, 50),
    abstentionTopP50: percentile(
      abstention.map((r) => r.topScore ?? 0).sort((a, b) => a - b),
      50,
    ),
  };
}

function pct(x) {
  return `${(x * 100).toFixed(0)}%`;
}

function renderTable(lines, byType, overall, heading) {
  if (heading) {
    lines.push(`## ${heading}`);
    lines.push('');
  }
  lines.push('| question type | n | hit@1 | hit@3 | hit@5 | MRR | NDCG@5 | misses |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const [type, s] of Object.entries(byType)) {
    lines.push(
      `| ${type} | ${s.n} | ${pct(s.hitAt1)} | ${pct(s.hitAt3)} | ${pct(s.hitAt5)} | ${s.mrr.toFixed(2)} | ${s.ndcgAt5.toFixed(2)} | ${s.misses} |`,
    );
  }
  lines.push(
    `| **all answerable** | ${overall.n} | ${pct(overall.hitAt1)} | ${pct(overall.hitAt3)} | ${pct(overall.hitAt5)} | ${overall.mrr.toFixed(2)} | ${overall.ndcgAt5.toFixed(2)} | ${overall.misses} |`,
  );
  lines.push('');
}

function renderMd({ meta, byType, overall, abstention, rerankResults }) {
  const lines = [];
  lines.push('# LongMemEval results');
  lines.push('');
  lines.push(`- date: ${meta.timestamp}`);
  lines.push(`- fixture: ${meta.fixture} (${meta.sessions} sessions, ${meta.questions} questions)`);
  lines.push(`- haystack: ${meta.scale}`);
  lines.push(`- index time: ${meta.indexElapsedSec.toFixed(1)}s`);
  lines.push('');
  renderTable(lines, byType, overall, rerankResults ? 'Hybrid (no rerank)' : null);
  if (rerankResults) {
    renderTable(lines, rerankResults.summaryByType, rerankResults.overall, 'Hybrid + cross-encoder rerank');
    lines.push(
      `Rerank correct-abstain rate: ${pct(rerankResults.abstention.correctAbstainRate)} ` +
        `(answerable top p50 ${rerankResults.abstention.answerableTopP50.toFixed(4)} vs ` +
        `abstention ${rerankResults.abstention.abstentionTopP50.toFixed(4)}).`,
    );
    lines.push('');
  }
  lines.push('## Abstention (negative control)');
  lines.push('');
  lines.push(
    `${abstention.n} questions with no correct evidence in the corpus. ` +
      `Score floor derived as p05 of answerable top scores: ${abstention.floor.toFixed(4)} - ` +
      'the metric measures score separation, not a hand-picked constant.',
  );
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| correct-abstain rate | ${pct(abstention.correctAbstainRate)} |`);
  lines.push(`| answerable top-score p50 | ${abstention.answerableTopP50.toFixed(4)} |`);
  lines.push(`| abstention top-score p50 | ${abstention.abstentionTopP50.toFixed(4)} |`);
  lines.push('');
  lines.push(
    `- latency p50/p95 (answerable): ${overall.p50ms.toFixed(0)} / ${overall.p95ms.toFixed(0)} ms`,
  );
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const notesDir = join(CACHE, args.oracle ? 'notes-oracle' : 'notes');
  const questionsPath = join(CACHE, args.oracle ? 'questions-oracle.json' : 'questions.json');
  let questions = JSON.parse(await readFile(questionsPath, 'utf8'));
  if (args.limit > 0) questions = questions.slice(0, args.limit);

  const allNotes = (await readdir(notesDir)).filter((f) => f.endsWith('.md'));
  const evidence = new Set(questions.flatMap((q) => q.expected));
  let noteFiles = allNotes;
  if (args.scale > 0 && args.scale < allNotes.length) {
    const fillers = allNotes.filter((f) => !evidence.has(f)).sort();
    const keep = Math.max(0, args.scale - evidence.size);
    noteFiles = [...evidence, ...fillers.slice(0, keep)];
  }
  process.stdout.write(
    `${noteFiles.length} sessions (${evidence.size} evidence, ${noteFiles.length - evidence.size} distractors) of ${allNotes.length} total, ${questions.length} questions\n`,
  );

  const tmpRoot = await mkdtemp(join(tmpdir(), 'metalmind-bench-longmemeval-'));
  const vault = join(tmpRoot, 'vault');
  await mkdir(vault, { recursive: true });
  registerTeardown(() => rm(tmpRoot, { recursive: true, force: true }));
  registerTeardown(() =>
    Promise.all([
      rm(join(homedir(), '.metalmind', `fts-${COLLECTION}.db`), { force: true }),
      rm(join(homedir(), '.metalmind', `vec-${COLLECTION}.db`), { force: true }),
    ]),
  );
  for (const f of noteFiles) {
    await copyFile(join(notesDir, f), join(vault, f));
  }

  const env = {
    ...process.env,
    VAULT_PATH: vault,
    VAULT_COLLECTION: COLLECTION,
    VAULT_HTTP_PORT: String(args.port),
  };

  process.stdout.write('indexing…\n');
  const indexStart = performance.now();
  await runOnce('metalmind-vault-rag-indexer', env, tmpRoot, args.indexHours * 60 * 60_000);
  const indexElapsedSec = (performance.now() - indexStart) / 1000;
  process.stdout.write(`indexed in ${indexElapsedSec.toFixed(1)}s\n`);

  const watcher = spawn('metalmind-vault-rag-watcher', [], {
    env,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  registerTeardown(async () => {
    if (!watcher.killed) watcher.kill('SIGTERM');
  });
  const endpoint = `http://127.0.0.1:${args.port}`;
  if (!(await waitForHttp(endpoint, 60_000))) {
    throw new Error(`watcher HTTP did not come up on ${endpoint}`);
  }

  if (args.rerank) {
    const res = await fetch(`${endpoint}/rerank/status`).catch(() => null);
    const available = res?.ok ? (await res.json()).available === true : false;
    if (!available) {
      throw new Error(
        'the [rerank] extra is not installed in the watcher venv. Without it the rerank pass ' +
          'silently returns embedder ordering and the column would mirror hybrid. Install with ' +
          "`uv tool install --force --reinstall 'metalmind-vault-rag[rerank]'` and rerun.",
      );
    }
    process.stdout.write('rerank=engaged (cross-encoder loadable)\n');
  }

  const answerable = [];
  const abstentionQ = [];
  const answerableRr = [];
  const abstentionRr = [];
  let done = 0;
  for (const q of questions) {
    for (const rerank of args.rerank ? [false, true] : [false]) {
      const { hits, elapsedMs } = await searchOnce(endpoint, q.query, rerank);
      const record = {
        id: q.id,
        type: q.type,
        rank: q.abstention ? null : hitRank(hits, q.expected),
        ndcg: q.abstention ? 0 : ndcgAt(hits, q.expected, K),
        topScore: typeof hits[0]?.score === 'number' ? hits[0].score : null,
        latencyMs: elapsedMs,
      };
      const bucket = rerank
        ? q.abstention
          ? abstentionRr
          : answerableRr
        : q.abstention
          ? abstentionQ
          : answerable;
      bucket.push(record);
    }
    done += 1;
    if (done % 25 === 0) process.stdout.write(`${done}/${questions.length}\n`);
  }

  await runTeardowns();

  function byTypeSummary(records) {
    const groups = {};
    for (const r of records) (groups[r.type] ??= []).push(r);
    return Object.fromEntries(
      Object.entries(groups)
        .sort()
        .map(([t, rs]) => [t, summarizeAnswerable(rs)]),
    );
  }
  const summaryByType = byTypeSummary(answerable);
  const overall = summarizeAnswerable(answerable);
  const abstention = scoreAbstention(answerable, abstentionQ);
  const rerankResults = args.rerank
    ? {
        summaryByType: byTypeSummary(answerableRr),
        overall: summarizeAnswerable(answerableRr),
        abstention: scoreAbstention(answerableRr, abstentionRr),
      }
    : null;

  const meta = {
    timestamp: new Date().toISOString(),
    fixture: args.oracle ? 'oracle (no distractors - smoke only)' : 'longmemeval_s_cleaned',
    scale: args.scale > 0 ? `${noteFiles.length} of ${allNotes.length} sessions` : 'full haystack',
    sessions: noteFiles.length,
    questions: questions.length,
    indexElapsedSec,
  };
  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = meta.timestamp.replace(/[:.]/g, '-');
  const md = renderMd({ meta, byType: summaryByType, overall, abstention, rerankResults });
  await writeFile(
    join(RESULTS_DIR, `longmemeval-${stamp}.json`),
    `${JSON.stringify({ meta, summaryByType, overall, abstention, rerankResults, answerable, abstentionQ, answerableRr, abstentionRr }, null, 2)}\n`,
  );
  await writeFile(join(RESULTS_DIR, `longmemeval-${stamp}.md`), md);
  process.stdout.write(`\n${md}`);
  process.stdout.write(`wrote ${join(RESULTS_DIR, `longmemeval-${stamp}.md`)}\n`);
}

main().catch(async (err) => {
  process.stderr.write(`run failed: ${err.stack ?? err}\n`);
  await runTeardowns();
  process.exit(1);
});
