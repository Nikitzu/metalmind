#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const K = 5;
const MISS_REPORT_THRESHOLD = 0.5;
const CLASSES = [
  'vocabulary-mismatch',
  'competing-near-duplicates',
  'distinguishing-detail',
  'temporal',
  'negation-and-absence',
];

const ENDPOINT =
  process.env.METALMIND_BENCH_ENDPOINT ??
  process.env.METALMIND_RECALL_HTTP ??
  'http://127.0.0.1:17317';
const VAULT = process.env.VAULT_PATH ?? join(homedir(), 'Knowledge');

function parseArgs(argv) {
  const out = { rerank: false, only: null, json: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--rerank') out.rerank = true;
    else if (argv[i] === '--class') out.only = argv[++i];
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

async function vaultStems() {
  const stems = new Set();
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.md')) stems.add(e.name.replace(/\.md$/, ''));
    }
  }
  await walk(VAULT);
  return stems;
}

async function vaultCommit() {
  try {
    const { stdout } = await promisify(execFile)('git', [
      '-C',
      VAULT,
      'rev-parse',
      '--short',
      'HEAD',
    ]);
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function searchOnce(query, rerank) {
  const t0 = performance.now();
  const res = await fetch(`${ENDPOINT}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, k: K, rerank }),
  });
  if (!res.ok) throw new Error(`watcher returned ${res.status} for: ${query}`);
  const json = await res.json();
  return { hits: json.hits ?? [], latencyMs: performance.now() - t0 };
}

const stemOf = (hit) =>
  String(hit.file ?? '')
    .split('/')
    .pop()
    ?.replace(/\.md$/, '') ?? '';

function rankOf(hits, expected) {
  for (let i = 0; i < hits.length; i += 1) if (stemOf(hits[i]) === expected) return i + 1;
  return null;
}

function summarise(rows) {
  const n = rows.length;
  if (n === 0) return null;
  const at = (k) => rows.filter((r) => r.rank !== null && r.rank <= k).length;
  return {
    n,
    hitAt1: at(1) / n,
    hitAt3: at(3) / n,
    hitAt5: at(5) / n,
    mrr: rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n,
    ndcgAt5: rows.reduce((s, r) => s + (r.rank ? 1 / Math.log2(r.rank + 1) : 0), 0) / n,
    misses: rows.filter((r) => r.rank === null).length,
  };
}

const pct = (x) => `${Math.round(x * 100)}%`;

function renderTable(lines, byClass, overall) {
  lines.push('| class | n | hit@1 | hit@3 | hit@5 | MRR | NDCG@5 | misses |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const [name, s] of byClass) {
    if (!s) continue;
    lines.push(
      `| ${name} | ${s.n} | ${pct(s.hitAt1)} | ${pct(s.hitAt3)} | ${pct(s.hitAt5)} | ` +
        `${s.mrr.toFixed(2)} | ${s.ndcgAt5.toFixed(2)} | ${s.misses} |`,
    );
  }
  lines.push(
    `| **all** | ${overall.n} | **${pct(overall.hitAt1)}** | **${pct(overall.hitAt3)}** | ` +
      `**${pct(overall.hitAt5)}** | **${overall.mrr.toFixed(2)}** | ` +
      `**${overall.ndcgAt5.toFixed(2)}** | ${overall.misses} |`,
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const payload = JSON.parse(await readFile(join(HERE, 'queries.json'), 'utf8'));
  let queries = payload.queries;
  if (args.only) queries = queries.filter((q) => q.class === args.only);
  if (queries.length === 0) throw new Error(`no queries for class '${args.only}'`);

  const stems = await vaultStems();
  const dangling = [...new Set(queries.map((q) => q.expected).filter((e) => !stems.has(e)))];
  if (dangling.length > 0) {
    throw new Error(
      `${dangling.length} expected note(s) no longer exist in ${VAULT}:\n  ${dangling.join('\n  ')}\n` +
        'A renamed or archived note scores as a retrieval failure forever. ' +
        'Fix queries.json before trusting any number from this run.',
    );
  }

  process.stdout.write(`${queries.length} queries against ${ENDPOINT} over ${stems.size} notes\n`);

  const rows = [];
  for (const q of queries) {
    const { hits, latencyMs } = await searchOnce(q.query, args.rerank);
    rows.push({ ...q, rank: rankOf(hits, q.expected), returned: hits.map(stemOf), latencyMs });
  }

  const byClass = (args.only ? [args.only] : CLASSES).map((c) => [
    c,
    summarise(rows.filter((r) => r.class === c)),
  ]);
  const overall = summarise(rows);

  const lines = [`# Adversarial recall - ${new Date().toISOString()}`, ''];
  lines.push(`- vault: ${VAULT} @ ${await vaultCommit()}`, `- notes: ${stems.size}`);
  lines.push(`- rerank: ${args.rerank ? 'on' : 'off'}`, `- k: ${K}`, '');
  renderTable(lines, byClass, overall);

  for (const [name, s] of byClass) {
    if (!s || s.hitAt5 >= MISS_REPORT_THRESHOLD) continue;
    const failed = rows.filter((r) => r.class === name && r.rank === null);
    if (failed.length === 0) continue;
    lines.push('', `## ${name} - ${failed.length} miss(es) at k=${K}`, '');
    for (const f of failed) {
      lines.push(`**${f.query}**`, '', `- expected: \`${f.expected}\``);
      lines.push(`- why hard: ${f.why_adversarial}`);
      lines.push(`- returned: ${f.returned.map((r) => `\`${r}\``).join(', ') || '(nothing)'}`, '');
    }
  }

  const md = `${lines.join('\n')}\n`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(join(HERE, 'results', `adversarial-${stamp}.md`), md);
  if (args.json) {
    await writeFile(
      join(HERE, 'results', `adversarial-${stamp}.json`),
      `${JSON.stringify({ rows, byClass, overall }, null, 2)}\n`,
    );
  }
  process.stdout.write(`\n${md}`);
}

main().catch((err) => {
  process.stderr.write(`bench failed: ${err.message}\n`);
  process.exitCode = 1;
});
