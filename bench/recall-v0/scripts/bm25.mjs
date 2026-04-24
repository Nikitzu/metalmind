// BM25 scorer — pure Node, no deps. Used as a baseline column in recall-v0.
//
// Standard Okapi BM25 with k1=1.5, b=0.75. Tokenization:
//   - Strip YAML frontmatter (--- ... ---).
//   - Lowercase.
//   - Split on non-word characters.
//   - Drop 1-char tokens and a minimal English stop-word set.
//
// Scored against the same vault the semantic path sees — tmp-vault assembled
// per-scale by run.mjs. Reading ≤1k small markdown files per run is cheap;
// we rebuild the index per call rather than caching.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const K1 = 1.5;
const B = 0.75;

const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'of', 'on',
  'or', 'that', 'the', 'this', 'to', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your', 'our',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'about',
]);

function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  return text.slice(end + 4);
}

function tokenize(text) {
  const body = stripFrontmatter(text).toLowerCase();
  const toks = body.split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
  return toks;
}

async function loadVault(vaultDir) {
  const entries = await readdir(vaultDir, { withFileTypes: true });
  const docs = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const path = join(vaultDir, e.name);
    const raw = await readFile(path, 'utf8');
    const toks = tokenize(raw);
    docs.push({ file: e.name, tokens: toks, length: toks.length });
  }
  return docs;
}

function buildIndex(docs) {
  const df = new Map();
  for (const d of docs) {
    const seen = new Set(d.tokens);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / (N || 1);
  const idf = new Map();
  for (const [t, n] of df.entries()) {
    idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }
  return { N, avgdl, idf };
}

function scoreDoc(doc, queryTokens, idx) {
  const { avgdl, idf } = idx;
  const counts = new Map();
  for (const t of doc.tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  let score = 0;
  for (const q of queryTokens) {
    const f = counts.get(q) ?? 0;
    if (f === 0) continue;
    const w = idf.get(q) ?? 0;
    const denom = f + K1 * (1 - B + (B * doc.length) / avgdl);
    score += w * ((f * (K1 + 1)) / denom);
  }
  return score;
}

export async function scoreQuery(vaultDir, query, k) {
  const docs = await loadVault(vaultDir);
  const idx = buildIndex(docs);
  const qToks = tokenize(query);
  const scored = docs.map((d) => ({ file: d.file, score: scoreDoc(d, qToks, idx) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).filter((h) => h.score > 0);
}

// Cached variant — index once per vault, score many queries. Used by the
// runner to avoid rebuilding for each of the 20 questions at each scale.
export async function buildScorer(vaultDir) {
  const docs = await loadVault(vaultDir);
  const idx = buildIndex(docs);
  return (query, k) => {
    const qToks = tokenize(query);
    const scored = docs.map((d) => ({ file: d.file, score: scoreDoc(d, qToks, idx) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).filter((h) => h.score > 0);
  };
}
