#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(homedir(), '.cache', 'metalmind-bench', 'confidence-bands');
const RESULTS_DIR = join(HERE, 'results');
const COLLECTION = 'metalmind_bench_confidence';
const SIDECAR = join(homedir(), '.metalmind', `${COLLECTION}.calibration.json`);

const EXPECTED_EDGES = { low: 0.697, high: 0.648 };
const EDGE_TOLERANCE = 0.02;
const K = 5;

function collectionFiles() {
  const dir = join(homedir(), '.metalmind');
  return ['fts', 'vec'].flatMap((prefix) =>
    ['', '-shm', '-wal'].map((suffix) => join(dir, `${prefix}-${COLLECTION}.db${suffix}`)),
  );
}

function parseArgs(argv) {
  const args = { vault: join(homedir(), 'Knowledge'), port: 17601, indexHours: 2, assert: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--vault') args.vault = argv[++i];
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--index-hours') args.indexHours = Number(argv[++i]);
    else if (argv[i] === '--assert') args.assert = true;
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
    const ok = await fetch(`${endpoint}/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function searchOnce(endpoint, query) {
  const res = await fetch(`${endpoint}/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, k: K }),
  });
  const body = await res.json();
  return Array.isArray(body) ? body : (body.hits ?? []);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function valuesOf(records, field) {
  return records.map((r) => (typeof r[field] === 'number' ? r[field] : 0)).sort((a, b) => a - b);
}

function auc(pos, neg, field) {
  const a = valuesOf(pos, field);
  const b = valuesOf(neg, field);
  if (a.length === 0 || b.length === 0) return 0;
  let better = 0;
  for (const x of a) for (const y of b) better += x > y ? 1 : x === y ? 0.5 : 0;
  return better / (a.length * b.length);
}

function bestOf(hits, field) {
  const vals = hits.map((h) => h[field]).filter((v) => typeof v === 'number');
  return vals.length === 0 ? null : Math.max(...vals);
}

function hitRank(hits, expected) {
  for (let i = 0; i < hits.length; i += 1) {
    if (expected.includes(hits[i].file)) return i + 1;
  }
  return null;
}

const SIGNALS = [
  ['fused (RRF)', 'fused'],
  ['semantic cosine, top hit', 'semTop'],
  ['semantic cosine, best of top-5', 'semMax'],
  ['BM25, top hit', 'kwTop'],
  ['BM25, best of top-5', 'kwMax'],
];

function bands(pos, neg, field) {
  const p = valuesOf(pos, field);
  const n = valuesOf(neg, field);
  const high = percentile(n, 90);
  const low = percentile(p, 10);
  const share = (records, lo, hi) => {
    const v = valuesOf(records, field);
    if (v.length === 0) return { low: 0, medium: 0, high: 0 };
    const loN = v.filter((x) => x < Math.min(lo, hi)).length;
    const hiN = v.filter((x) => x >= Math.max(lo, hi)).length;
    return {
      low: loN / v.length,
      medium: (v.length - loN - hiN) / v.length,
      high: hiN / v.length,
    };
  };
  return {
    highEdge: high,
    lowEdge: low,
    separated: low >= high,
    positives: share(pos, low, high),
    negatives: share(neg, low, high),
  };
}

function pct(x) {
  return `${(x * 100).toFixed(0)}%`;
}

function summarize(records) {
  const ranked = records.filter((r) => r.rank !== null);
  return {
    n: records.length,
    hitAt1: records.length === 0 ? 0 : records.filter((r) => r.rank === 1).length / records.length,
    hitAt5: records.length === 0 ? 0 : ranked.length / records.length,
  };
}

function renderSelfDerived(lines, derived) {
  lines.push('## Edges the tool derived for itself');
  lines.push('');
  lines.push(
    'The tables above are the measurement. This is what shipped calibration ' +
      'produced unaided during the same index, and it is the number that regresses. ' +
      'Both are recomputed from the vault every run, so neither is a constant.',
  );
  lines.push('');
  if (!derived) {
    lines.push('Calibration declined to derive bands for this vault.');
    lines.push('');
    return;
  }
  lines.push('| edge | derived | expected | delta | tolerance |');
  lines.push('|---|---|---|---|---|');
  for (const [name, value] of [
    ['low', derived.low_edge],
    ['high', derived.high_edge],
  ]) {
    const expected = EXPECTED_EDGES[name];
    lines.push(
      `| ${name} | ${value.toFixed(4)} | ${expected.toFixed(4)} | ${Math.abs(value - expected).toFixed(4)} | ${EDGE_TOLERANCE} |`,
    );
  }
  lines.push('');
  lines.push(`Sampled from ${derived.positives_n} excerpt queries and ${derived.probes_n} probes.`);
  lines.push('');
}

function renderMd({ meta, sets, signals, bandTable, derived }) {
  const lines = [];
  lines.push('# Confidence band edges on a real vault');
  lines.push('');
  lines.push(`- date: ${meta.timestamp}`);
  lines.push(`- corpus: ${meta.notes} notes (a working personal vault, not a generated fixture)`);
  lines.push(`- excerpt positives: ${meta.excerpt} | manual positives: ${meta.manual} | negatives: ${meta.negatives}`);
  lines.push('');
  lines.push(
    'The corpus is private, so this file records aggregate statistics only. No note names, ' +
      'no snippets, and no query text appear here or in the JSON beside it. The query sets ' +
      'live under `~/.cache/metalmind-bench/confidence-bands/` and are not committed.',
  );
  lines.push('');
  lines.push('Negatives are LongMemEval questions run against this vault. They are third-party');
  lines.push('authored and out of domain, so nobody who maintains the vault wrote them.');
  lines.push('');
  lines.push('## Retrieval, for context');
  lines.push('');
  lines.push('| positive set | n | hit@1 | hit@5 |');
  lines.push('|---|---|---|---|');
  for (const [name, s] of Object.entries(sets)) {
    lines.push(`| ${name} | ${s.n} | ${pct(s.hitAt1)} | ${pct(s.hitAt5)} |`);
  }
  lines.push('');
  lines.push('## Signal separation');
  lines.push('');
  lines.push('| signal | AUC (excerpt) | AUC (manual) |');
  lines.push('|---|---|---|');
  for (const s of signals) {
    lines.push(`| ${s.label} | ${s.excerpt.toFixed(3)} | ${s.manual === null ? 'n/a' : s.manual.toFixed(3)} |`);
  }
  lines.push('');
  lines.push('## Band edges');
  lines.push('');
  lines.push(
    'The high edge is the 90th percentile of negative scores: above it, an out-of-domain ' +
      'question almost never reaches. The low edge is the 10th percentile of positive scores: ' +
      'below it, a real answer rarely sits. When the low edge is above the high edge the classes ' +
      'are cleanly separated; when it is below, the gap between them is the ambiguous middle band.',
  );
  lines.push('');
  lines.push('| positive set | signal | low edge | high edge | separated |');
  lines.push('|---|---|---|---|---|');
  for (const b of bandTable) {
    lines.push(
      `| ${b.set} | ${b.label} | ${b.lowEdge.toFixed(4)} | ${b.highEdge.toFixed(4)} | ${b.separated ? 'yes' : 'no'} |`,
    );
  }
  lines.push('');
  lines.push('| positive set | signal | positives low/med/high | negatives low/med/high |');
  lines.push('|---|---|---|---|');
  for (const b of bandTable) {
    lines.push(
      `| ${b.set} | ${b.label} | ${pct(b.positives.low)} / ${pct(b.positives.medium)} / ${pct(b.positives.high)} | ` +
        `${pct(b.negatives.low)} / ${pct(b.negatives.medium)} / ${pct(b.negatives.high)} |`,
    );
  }
  lines.push('');
  renderSelfDerived(lines, derived);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const excerptQ = JSON.parse(await readFile(join(CACHE, 'excerpt.json'), 'utf8'));
  const negativeQ = JSON.parse(await readFile(join(CACHE, 'negative.json'), 'utf8'));
  const manualQ = await readFile(join(CACHE, 'manual.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => []);

  const tmpRoot = await mkdtemp(join(tmpdir(), 'metalmind-bench-confidence-'));
  const vault = join(tmpRoot, 'vault');
  await mkdir(vault, { recursive: true });
  registerTeardown(() => rm(tmpRoot, { recursive: true, force: true }));
  registerTeardown(() =>
    Promise.all([
      ...collectionFiles().map((f) => rm(f, { force: true })),
      rm(SIDECAR, { force: true }),
    ]),
  );

  let noteCount = 0;
  async function copyTree(src, dst) {
    for (const entry of await readdir(src, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const from = join(src, entry.name);
      const to = join(dst, entry.name);
      if (entry.isDirectory()) {
        await mkdir(to, { recursive: true });
        await copyTree(from, to);
      } else if (entry.name.endsWith('.md')) {
        await copyFile(from, to);
        noteCount += 1;
      }
    }
  }
  await copyTree(args.vault, vault);

  const env = {
    ...process.env,
    VAULT_PATH: vault,
    VAULT_COLLECTION: COLLECTION,
    VAULT_HTTP_PORT: String(args.port),
  };

  process.stdout.write('indexing…\n');
  await runOnce('metalmind-vault-rag-indexer', env, tmpRoot, args.indexHours * 60 * 60_000);

  const watcher = spawn('metalmind-vault-rag-watcher', [], { env, stdio: ['ignore', 'ignore', 'ignore'] });
  registerTeardown(async () => {
    if (!watcher.killed) watcher.kill('SIGTERM');
  });
  const endpoint = `http://127.0.0.1:${args.port}`;
  if (!(await waitForHttp(endpoint, 60_000))) {
    throw new Error(`watcher HTTP did not come up on ${endpoint}`);
  }

  const records = { excerpt: [], manual: [], negative: [] };
  const negativeReview = [];
  const all = [...excerptQ, ...manualQ, ...negativeQ];
  let done = 0;
  for (const q of all) {
    const hits = await searchOnce(endpoint, q.query);
    records[q.set].push({
      rank: q.expected.length === 0 ? null : hitRank(hits, q.expected),
      fused: typeof hits[0]?.score === 'number' ? hits[0].score : null,
      semTop: typeof hits[0]?.sem_score === 'number' ? hits[0].sem_score : null,
      kwTop: typeof hits[0]?.kw_score === 'number' ? hits[0].kw_score : null,
      semMax: bestOf(hits, 'sem_score'),
      kwMax: bestOf(hits, 'kw_score'),
    });
    if (q.set === 'negative') {
      negativeReview.push({
        id: q.id,
        query: q.query,
        semMax: bestOf(hits, 'sem_score'),
        topFile: hits[0]?.file ?? null,
      });
    }
    done += 1;
    if (done % 50 === 0) process.stdout.write(`${done}/${all.length}\n`);
  }

  const derived = await readFile(SIDECAR, 'utf8')
    .then(JSON.parse)
    .catch(() => null);

  await runTeardowns();

  const signals = SIGNALS.map(([label, field]) => ({
    label,
    field,
    excerpt: auc(records.excerpt, records.negative, field),
    manual: records.manual.length === 0 ? null : auc(records.manual, records.negative, field),
  }));

  const bandTable = [];
  for (const [setName, pos] of [
    ['excerpt', records.excerpt],
    ['manual', records.manual],
  ]) {
    if (pos.length === 0) continue;
    for (const [label, field] of SIGNALS) {
      bandTable.push({ set: setName, label, field, ...bands(pos, records.negative, field) });
    }
  }

  const meta = {
    timestamp: new Date().toISOString(),
    notes: noteCount,
    excerpt: records.excerpt.length,
    manual: records.manual.length,
    negatives: records.negative.length,
  };
  const sets = {
    excerpt: summarize(records.excerpt),
    ...(records.manual.length > 0 ? { manual: summarize(records.manual) } : {}),
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = meta.timestamp.replace(/[:.]/g, '-');
  const md = renderMd({ meta, sets, signals, bandTable, derived });
  await writeFile(
    join(RESULTS_DIR, `confidence-bands-${stamp}.json`),
    `${JSON.stringify({ meta, sets, signals, bandTable, records }, null, 2)}\n`,
  );
  await writeFile(join(RESULTS_DIR, `confidence-bands-${stamp}.md`), md);
  await writeFile(
    join(CACHE, 'negative-review.json'),
    `${JSON.stringify(negativeReview.sort((a, b) => (b.semMax ?? 0) - (a.semMax ?? 0)), null, 2)}\n`,
  );
  process.stdout.write(`\n${md}`);
  process.stdout.write(`wrote ${join(RESULTS_DIR, `confidence-bands-${stamp}.md`)}\n`);
  process.stdout.write(`negatives to eyeball: ${join(CACHE, 'negative-review.json')}\n`);

  if (args.assert) {
    const problems = [];
    if (!derived) {
      problems.push('calibration derived no bands for this vault');
    } else {
      for (const [name, key] of [
        ['low', 'low_edge'],
        ['high', 'high_edge'],
      ]) {
        const delta = Math.abs(derived[key] - EXPECTED_EDGES[name]);
        if (delta > EDGE_TOLERANCE) {
          problems.push(
            `${name} edge ${derived[key].toFixed(4)} is ${delta.toFixed(4)} from the expected ` +
              `${EXPECTED_EDGES[name]} (tolerance ${EDGE_TOLERANCE})`,
          );
        }
      }
    }
    if (problems.length > 0) {
      process.stderr.write(`\nregression: ${problems.join('; ')}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write('regression: self-derived edges within tolerance\n');
  }
}

main().catch(async (err) => {
  process.stderr.write(`run failed: ${err.stack ?? err}\n`);
  await runTeardowns();
  process.exit(1);
});
