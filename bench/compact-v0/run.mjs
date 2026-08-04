#!/usr/bin/env node
// compact-v0 runner.
//
// Measures the recall-OUTPUT token cost of `tap copper` rendered two ways:
//   - verbose : current default (full JSON dump per hit, incl. prev_score)
//   - compact : `--compact` (lean per-hit envelope, snippet-truncated text)
//
// Unlike mcp-tax-v0 (which measures the STANDING schema tax - already zero for
// metalmind), this measures the per-RECALL payload tax: the bytes billed every
// time the agent runs a recall. The compact path is display-only, so the set of
// files returned is identical between modes - the runner asserts this per query
// and refuses to report a saving if retrieval drifted (that would mean compact
// changed what was recalled, not just how it was rendered).
//
// Token counting matches mcp-tax-v0: Anthropic /v1/messages/count_tokens when
// ANTHROPIC_API_KEY is set, char/4 approximation otherwise (--offline forces it).
//
// Usage:
//   node bench/compact-v0/run.mjs                       # offline approx, fast tier
//   ANTHROPIC_API_KEY=sk-ant-... node bench/compact-v0/run.mjs
//   node bench/compact-v0/run.mjs --tier deep --k 5
//   METALMIND_BENCH_ENDPOINT=http://127.0.0.1:17317 node bench/compact-v0/run.mjs

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, 'results');
const CLI = join(HERE, '..', '..', 'cli', 'dist', 'cli.js');

const OFFLINE = process.argv.includes('--offline') || !process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.METALMIND_BENCH_MODEL ?? 'claude-sonnet-4-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const APPROX_CHARS_PER_TOKEN = 4;

const ENDPOINT =
  process.env.METALMIND_BENCH_ENDPOINT ??
  process.env.METALMIND_RECALL_HTTP ??
  'http://127.0.0.1:17317';

function parseArgs(argv) {
  const out = { tier: 'fast', k: 5 };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--tier') out.tier = argv[++i];
    else if (argv[i] === '--k') out.k = Number(argv[++i]);
  }
  return out;
}

// Queries tuned to land on a real metalmind-development vault. The absolute
// topic doesn't matter - we measure render cost over whatever hits come back.
const QUERIES = [
  'why is recall a bash command instead of an MCP tool',
  'how does the vault-rag watcher serve recall over HTTP',
  'what is the token tax of registering an MCP server',
  'roadmap for proving the zero schema tax moat',
  'how do scribe verbs stamp frontmatter and link MOCs',
  'sentinel bounded stamp blocks uninstall safety',
  'graphify code graph integration and god nodes',
  'recall ladder fast deep expand tiers token cost',
  'forge cross repo route edges openapi shelf',
  'product positioning versus mem0 and Letta',
  'rerank cross encoder onnx opt-in tier',
  'codex host integration opt in mcp server',
];

function approxTokens(text) {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

async function countTokensApi(text) {
  const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: text }] }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  return (await res.json()).input_tokens;
}

async function countTokens(text) {
  if (text.length === 0) return 0;
  if (OFFLINE) return approxTokens(text);
  return countTokensApi(text);
}

function runCli(query, tier, k, compact) {
  return new Promise((resolve, reject) => {
    const args = ['tap', 'copper', query, '-k', String(k)];
    if (tier === 'deep') args.push('--deep');
    else if (tier === 'expand') args.push('--expand');
    if (compact) args.push('--compact');
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, METALMIND_RECALL_HTTP: ENDPOINT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', () => undefined);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`cli exit ${code}`)),
    );
    child.on('error', reject);
  });
}

// Pull the ordered primary-hit file list from either render to assert compact
// changed only the rendering, never the retrieval. Strip the deep/expand tail
// first - the related/expansions block lists LINKED notes, not hits, and only
// the verbose render dumps them, so counting it would be a false drift signal.
function headBeforeTail(text) {
  const idx = text.search(/\n(?:---related|---expansions|\+\d+ linked|\+related)/);
  return idx === -1 ? text : text.slice(0, idx);
}
function filesFromVerbose(text) {
  return [...headBeforeTail(text).matchAll(/^\s*"file":\s*"([^"]+)"/gm)].map((m) => m[1]);
}
function filesFromCompact(text) {
  return [...headBeforeTail(text).matchAll(/^\d+\.\s+\[[^\]]*\]\s+(\S+)/gm)].map((m) => m[1]);
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const { tier, k } = parseArgs(process.argv);
  await mkdir(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  const perQ = [];
  let driftCount = 0;
  for (const query of QUERIES) {
    const verbose = await runCli(query, tier, k, false);
    const compact = await runCli(query, tier, k, true);
    const vFiles = filesFromVerbose(verbose);
    const cFiles = filesFromCompact(compact);
    const retrievalIdentical = JSON.stringify(vFiles) === JSON.stringify(cFiles);
    if (!retrievalIdentical) driftCount += 1;

    const vTok = await countTokens(verbose);
    const cTok = await countTokens(compact);
    const saved = vTok - cTok;
    const rate = vTok > 0 ? saved / vTok : 0;
    perQ.push({
      query,
      hits: vFiles.length,
      verboseTokens: vTok,
      compactTokens: cTok,
      saved,
      savingRate: rate,
      retrievalIdentical,
    });
    process.stdout.write(
      `${retrievalIdentical ? '✓' : '✗DRIFT'}  ${String(vTok).padStart(5)} → ${String(cTok).padStart(5)}  (-${pct(rate).padStart(5)})  ${query}\n`,
    );
  }

  const sumV = perQ.reduce((a, r) => a + r.verboseTokens, 0);
  const sumC = perQ.reduce((a, r) => a + r.compactTokens, 0);
  const totalRate = sumV > 0 ? (sumV - sumC) / sumV : 0;
  const meta = {
    ts,
    endpoint: ENDPOINT,
    tier,
    k,
    mode: OFFLINE ? 'offline-char/4-approximation' : 'anthropic-count-tokens',
    model: OFFLINE ? null : MODEL,
    queries: QUERIES.length,
  };
  const summary = {
    verboseTokensTotal: sumV,
    compactTokensTotal: sumC,
    savedTotal: sumV - sumC,
    savingRate: totalRate,
    verboseMeanPerRecall: Math.round(sumV / QUERIES.length),
    compactMeanPerRecall: Math.round(sumC / QUERIES.length),
    retrievalDriftQueries: driftCount,
  };

  const jsonPath = join(RESULTS_DIR, `${ts}.json`);
  await writeFile(jsonPath, `${JSON.stringify({ meta, summary, perQ }, null, 2)}\n`, 'utf8');

  process.stdout.write('\n');
  process.stdout.write(
    `tier=${tier} k=${k} mode=${meta.mode}\n` +
      `verbose total=${sumV}  compact total=${sumC}  saved=${sumV - sumC} (${pct(totalRate)})\n` +
      `mean/recall: verbose=${summary.verboseMeanPerRecall}  compact=${summary.compactMeanPerRecall}\n` +
      `retrieval drift: ${driftCount}/${QUERIES.length} queries\n` +
      `results: ${jsonPath}\n`,
  );

  // Gate: compact must save tokens AND never change retrieval. Drift = bug.
  if (driftCount > 0 || totalRate <= 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`bench failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(2);
});
