#!/usr/bin/env node

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

const OUT_DIR = join(homedir(), '.cache', 'metalmind-bench', 'confidence-bands');
const LONGMEMEVAL_QUESTIONS = join(
  homedir(),
  '.cache',
  'metalmind-bench',
  'longmemeval',
  'questions.json',
);

const EXCERPT_WORDS = 14;
const MIN_SENTENCE_WORDS = 12;
const NEGATIVE_SAMPLE = 80;

function parseArgs(argv) {
  const args = { vault: join(homedir(), 'Knowledge'), seed: 20260813 };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--vault') args.vault = argv[++i];
    else if (argv[i] === '--seed') args.seed = Number(argv[++i]);
  }
  return args;
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function walk(dir, root, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, root, out);
    else if (entry.name.endsWith('.md')) out.push(relative(root, full));
  }
  return out;
}

function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  return end === -1 ? text : text.slice(end + 4);
}

const WORD = /[A-Za-z0-9]+/g;

function bodySentences(text) {
  const out = [];
  for (const rawLine of stripFrontmatter(text).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('|') || line.startsWith('```')) continue;
    if (line.startsWith('>') || /^[-*]\s*\[/.test(line)) continue;
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const clean = sentence.replace(/^[-*+]\s+/, '').trim();
      if ((clean.match(WORD) ?? []).length >= MIN_SENTENCE_WORDS) out.push(clean);
    }
  }
  return out;
}

function excerptQuery(sentence, file) {
  const titleTokens = new Set((file.match(WORD) ?? []).map((w) => w.toLowerCase()));
  const words = (sentence.match(WORD) ?? []).filter((w) => !titleTokens.has(w.toLowerCase()));
  return words.slice(0, EXCERPT_WORDS).join(' ');
}

async function main() {
  const args = parseArgs(process.argv);
  await stat(args.vault).catch(() => {
    throw new Error(`vault not found at ${args.vault}`);
  });

  const files = await walk(args.vault, args.vault);
  const rand = mulberry32(args.seed);

  const excerpt = [];
  for (const file of files) {
    const text = await readFile(join(args.vault, file), 'utf8');
    const sentences = bodySentences(text);
    if (sentences.length === 0) continue;
    const pick = sentences[Math.floor(rand() * sentences.length)];
    const query = excerptQuery(pick, file);
    if ((query.match(WORD) ?? []).length < 8) continue;
    excerpt.push({ id: `E-${excerpt.length + 1}`, query, expected: [file], set: 'excerpt' });
  }

  const lme = await readFile(LONGMEMEVAL_QUESTIONS, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (!lme) {
    throw new Error(
      `no LongMemEval questions at ${LONGMEMEVAL_QUESTIONS}. Run bench/longmemeval/build-fixture.mjs first - ` +
        'the negative set is drawn from it so that nobody who maintains this vault authored the negatives.',
    );
  }
  const shuffled = [...lme].sort(() => rand() - 0.5);
  const negatives = shuffled.slice(0, NEGATIVE_SAMPLE).map((q, i) => ({
    id: `N-${i + 1}`,
    query: q.query,
    expected: [],
    set: 'negative',
  }));

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'excerpt.json'), `${JSON.stringify(excerpt, null, 2)}\n`);
  await writeFile(join(OUT_DIR, 'negative.json'), `${JSON.stringify(negatives, null, 2)}\n`);

  const manualPath = join(OUT_DIR, 'manual.json');
  const existing = await readFile(manualPath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (!existing) {
    await writeFile(manualPath, '[]\n');
  }

  process.stdout.write(
    `vault: ${files.length} notes at ${args.vault}\n` +
      `excerpt positives: ${excerpt.length}\n` +
      `negatives (LongMemEval, out of domain): ${negatives.length}\n` +
      `manual positives: ${existing ? existing.length : 0} (author them in ${manualPath})\n` +
      `wrote ${OUT_DIR}\n` +
      'These files quote the vault. They live outside the repo on purpose - do not copy them in.\n',
  );
}

main().catch((err) => {
  process.stderr.write(`build failed: ${err.stack ?? err}\n`);
  process.exit(1);
});
