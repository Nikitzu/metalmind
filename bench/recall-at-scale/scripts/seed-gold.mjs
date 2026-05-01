#!/usr/bin/env node
// Pick gold comments from the HN cache and synthesize paraphrase queries.
//
// Strategy:
//   - group cached comments by story_id
//   - keep stories with >=story-min comments AND a non-empty story_title
//   - deterministically sample K stories (mulberry32 seed)
//   - for each story: pick the longest comment as gold; query is a paraphrase
//     of the story_title (lower-cased, leading "Ask HN:" stripped, prefixed
//     with one of a handful of natural-language wrappers)
//
// Output: questions.json at the bench root, schema mirrors recall-v0:
//   { id, query, expected:[basename], tags:[story_id] }
//
// Honest limit: paraphrasing from titles is shallower than the hand-authored
// recall-v0 questions. The bench is about scale, not query quality.

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE = join(homedir(), '.cache', 'metalmind-bench', 'hn');
const DEFAULT_OUT = join(HERE, '..', 'questions.json');

const QUERY_TEMPLATES = [
  'what did people say about {topic}',
  'discussion of {topic}',
  'comments on {topic}',
  '{topic} - hn discussion',
  'reactions to {topic}',
];

function parseArgs(argv) {
  const out = { cache: DEFAULT_CACHE, out: DEFAULT_OUT, k: 20, seed: 42, storyMin: 5 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cache') out.cache = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--k') out.k = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--story-min') out.storyMin = Number(argv[++i]);
    else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'usage: seed-gold.mjs [--cache <dir>] [--out <path>] [--k 20] [--seed 42] [--story-min 5]\n',
      );
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.k) || out.k < 1) throw new Error(`bad --k: ${out.k}`);
  return out;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]+?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([^:]+):\s*"?(.*?)"?$/);
    if (kv) out[kv[1].trim()] = kv[2];
  }
  return out;
}

function bodyFrom(text) {
  const m = text.match(/^---\n[\s\S]+?\n---\n([\s\S]+)$/);
  return m ? m[1].trim() : text;
}

function paraphrase(title, rng) {
  const cleaned = title
    .replace(/^(Ask HN|Show HN|Tell HN):\s*/i, '')
    .replace(/\s+\([^)]*\)\s*$/, '')
    .trim();
  const tpl = QUERY_TEMPLATES[Math.floor(rng() * QUERY_TEMPLATES.length)];
  return tpl.replace('{topic}', cleaned.toLowerCase());
}

async function main() {
  const args = parseArgs(process.argv);
  if (!existsSync(args.cache)) throw new Error(`cache not found: ${args.cache}`);

  const files = (await readdir(args.cache)).filter((f) => f.endsWith('.md'));
  const stories = new Map();
  for (const f of files) {
    const text = await readFile(join(args.cache, f), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm.story_id || !fm.story_title) continue;
    const body = bodyFrom(text);
    if (body.length < 200) continue;
    if (!stories.has(fm.story_id)) {
      stories.set(fm.story_id, { story_id: fm.story_id, story_title: fm.story_title, comments: [] });
    }
    stories.get(fm.story_id).comments.push({ basename: f, body });
  }

  const eligible = [...stories.values()]
    .filter((s) => s.comments.length >= args.storyMin)
    .sort((a, b) => a.story_id.localeCompare(b.story_id));

  if (eligible.length < args.k) {
    throw new Error(
      `only ${eligible.length} stories meet story-min=${args.storyMin}; need ${args.k}. ` +
      `Run fetch-hn.mjs with a larger --n.`,
    );
  }

  const rng = mulberry32(args.seed);
  const picked = [];
  const taken = new Set();
  while (picked.length < args.k) {
    const idx = Math.floor(rng() * eligible.length);
    if (taken.has(idx)) continue;
    taken.add(idx);
    picked.push(eligible[idx]);
  }

  const questions = picked.map((story, i) => ({
    id: `H${String(i + 1).padStart(2, '0')}`,
    query: paraphrase(story.story_title, rng),
    expected: story.comments.map((c) => c.basename),
    tags: [`story:${story.story_id}`, 'hn', `comments:${story.comments.length}`],
  }));

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(questions, null, 2) + '\n', 'utf8');
  process.stdout.write(
    JSON.stringify(
      { out: args.out, eligible: eligible.length, picked: questions.length },
      null,
      2,
    ) + '\n',
  );
}

main().catch((err) => {
  process.stderr.write(`seed-gold failed: ${err.message}\n`);
  process.exit(1);
});
