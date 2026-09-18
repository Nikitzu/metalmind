#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
}
const queries = JSON.parse(
  await readFile(args.queries ?? new URL('./queries.json', import.meta.url), 'utf8'),
);
const cli = args.cli ?? 'metalmind';
const mode = args.mode ?? 'batched';

function run(query, extra, judgeMode) {
  const out = execFileSync(cli, ['tap', 'copper', query, '--json', '-k', '5', ...extra], {
    encoding: 'utf8',
    env: { ...process.env, METALMIND_JUDGE_MODE: judgeMode ?? mode },
  });
  return JSON.parse(out);
}

function rankOf(hits, file) {
  const i = hits.findIndex((h) => h.file === file);
  return i === -1 ? null : i + 1;
}

const rows = [];
for (const q of queries) {
  const plain = run(q.query, ['--no-judge']);
  const cross = run(q.query, ['--no-judge', '--rerank']);
  const judged = run(q.query, [], 'batched');
  const each = run(q.query, [], 'each');
  rows.push({
    query: q.query,
    expected: q.answers,
    plain: q.answers ? rankOf(plain.hits ?? [], q.answers) : (plain.hits ?? []).length,
    cross: q.answers ? rankOf(cross.hits ?? [], q.answers) : (cross.hits ?? []).length,
    judged: q.answers ? rankOf(judged.hits ?? [], q.answers) : (judged.hits ?? []).length,
    each: q.answers ? rankOf(each.hits ?? [], q.answers) : (each.hits ?? []).length,
    judgedKept: (judged.hits ?? []).filter((h) => h.judge && h.judge.score >= 1.0).length,
    eachKept: (each.hits ?? []).filter((h) => h.judge && h.judge.score >= 1.0).length,
  });
}

const answerable = rows.filter((r) => r.expected);
const mrr = (key) =>
  answerable.reduce((s, r) => s + (r[key] ? 1 / r[key] : 0), 0) / answerable.length;
const top1 = (key) => answerable.filter((r) => r[key] === 1).length;
const unanswerable = rows.filter((r) => !r.expected);

console.table(rows);
console.log(`answerable: ${answerable.length}`);
console.log(
  `top-1  plain ${top1('plain')}  cross ${top1('cross')}  judged(batched) ${top1('judged')}  judged(each) ${top1('each')}`,
);
console.log(
  `MRR    plain ${mrr('plain').toFixed(3)}  cross ${mrr('cross').toFixed(3)}  judged(batched) ${mrr('judged').toFixed(3)}  judged(each) ${mrr('each').toFixed(3)}`,
);
console.log(
  `unanswerable hits kept: batched ${unanswerable.map((r) => r.judgedKept).join(',')}  each ${unanswerable.map((r) => r.eachKept).join(',')} (plain always shows 5)`,
);
