#!/usr/bin/env node
// Pull HN comments from the Algolia public mirror into a deterministic on-disk
// cache that recall-at-scale runs against. Algolia caps `page * hitsPerPage`
// at ~1000 *per time window*, so we step backwards in fixed time windows
// (default 14 days) and pull up to hitsPerPage per window. This works around
// the cutoff-stuck-at-busy-second issue you hit with a single moving cutoff.
//
// Output: <cache>/<objectID>.md  one comment per file, frontmatter + body.
// Idempotent: skips files that already exist.
//
// Flags:
//   --n <N>           target number of comments (default 1000)
//   --cache <path>    cache root (default ~/.cache/metalmind-bench/hn)
//   --story-min <N>   only keep comments whose parent story has >=N comments
//                     in the same fetch (default 0; recommend 5 when seeding gold)
//   --max-pages <N>   safety cap (default 200)
//   --resume          start cutoff from oldest cached file
//
// Honest limit: Algolia is best-effort, public, rate-limited. Don't run with
// --n 50000 on a coffee shop wifi; expect ~5-10 min for 50k locally.

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_CACHE = join(homedir(), '.cache', 'metalmind-bench', 'hn');
const HITS_PER_PAGE = 1000;
const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1/search';
const RETRY_DELAYS_MS = [500, 1500, 4000];

function parseArgs(argv) {
  const out = {
    n: 1000,
    cache: DEFAULT_CACHE,
    storyMin: 0,
    maxWindows: 500,
    windowDays: 14,
    resume: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--n') out.n = Number(argv[++i]);
    else if (a === '--cache') out.cache = argv[++i];
    else if (a === '--story-min') out.storyMin = Number(argv[++i]);
    else if (a === '--max-windows' || a === '--max-pages') out.maxWindows = Number(argv[++i]);
    else if (a === '--window-days') out.windowDays = Number(argv[++i]);
    else if (a === '--resume') out.resume = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'usage: fetch-hn.mjs [--n 1000] [--cache <dir>] [--story-min 0] [--max-windows 500] [--window-days 14] [--resume]\n',
      );
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.n) || out.n < 1) throw new Error(`bad --n: ${out.n}`);
  return out;
}

async function fetchWindow(start, end, attempt = 0) {
  const url = `${ALGOLIA_BASE}?tags=comment&hitsPerPage=${HITS_PER_PAGE}&numericFilters=created_at_i%3E${start},created_at_i%3C${end}`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'metalmind-bench/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      return fetchWindow(start, end, attempt + 1);
    }
    throw err;
  }
}

function escapeFm(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/"/g, '\\"').replace(/\n/g, ' ').slice(0, 500);
}

function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<p>/g, '\n\n')
    .replace(/<\/p>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, '$2 ($1)')
    .replace(/<i>|<\/i>|<em>|<\/em>/g, '*')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .trim();
}

function commentToNote(hit) {
  const title = hit.story_title ? `re: ${hit.story_title}` : `comment-${hit.objectID}`;
  const body = htmlToText(hit.comment_text || '');
  const fm = [
    '---',
    `objectID: "${escapeFm(hit.objectID)}"`,
    `story_id: "${escapeFm(hit.story_id ?? '')}"`,
    `story_title: "${escapeFm(hit.story_title ?? '')}"`,
    `author: "${escapeFm(hit.author ?? '')}"`,
    `created_at: "${escapeFm(hit.created_at ?? '')}"`,
    'kind: hn-comment',
    '---',
  ].join('\n');
  return `${fm}\n\n# ${title}\n\n${body}\n`;
}

async function oldestCachedTimestamp(cacheDir) {
  if (!existsSync(cacheDir)) return null;
  const files = await readdir(cacheDir);
  let oldest = null;
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    try {
      const text = await readFile(join(cacheDir, f), 'utf8');
      const m = text.match(/created_at:\s*"([^"]+)"/);
      if (!m) continue;
      const t = Math.floor(new Date(m[1]).getTime() / 1000);
      if (Number.isFinite(t) && (oldest === null || t < oldest)) oldest = t;
    } catch {
      // skip
    }
  }
  return oldest;
}

async function main() {
  const args = parseArgs(process.argv);
  await mkdir(args.cache, { recursive: true });

  const windowSec = Math.max(1, Math.floor(args.windowDays * 86400));
  let end = Math.floor(Date.now() / 1000);
  if (args.resume) {
    const oldest = await oldestCachedTimestamp(args.cache);
    if (oldest) {
      end = oldest;
      process.stderr.write(`resume: end=${end}\n`);
    }
  }

  const cachedBefore = (await readdir(args.cache)).filter((f) => f.endsWith('.md')).length;
  let written = 0;
  let windows = 0;
  let total = cachedBefore;

  while (written < args.n && windows < args.maxWindows) {
    windows += 1;
    const start = end - windowSec;
    process.stderr.write(`window ${windows} [${start}..${end}] cached=${total}\n`);
    const json = await fetchWindow(start, end);
    end = start;
    if (!json.hits || json.hits.length === 0) continue;

    const storyCounts = new Map();
    for (const hit of json.hits) {
      if (hit.story_id) storyCounts.set(hit.story_id, (storyCounts.get(hit.story_id) ?? 0) + 1);
    }

    for (const hit of json.hits) {
      if (!hit.objectID || !hit.comment_text) continue;
      if (args.storyMin > 0 && (storyCounts.get(hit.story_id) ?? 0) < args.storyMin) continue;
      const file = join(args.cache, `${hit.objectID}.md`);
      if (existsSync(file)) continue;
      await writeFile(file, commentToNote(hit), 'utf8');
      written += 1;
      total += 1;
      if (written >= args.n) break;
    }
  }

  process.stdout.write(
    JSON.stringify(
      { cache: args.cache, cachedBefore, written, total, windows },
      null,
      2,
    ) + '\n',
  );
}

main().catch((err) => {
  process.stderr.write(`fetch-hn failed: ${err.message}\n`);
  process.exit(1);
});
