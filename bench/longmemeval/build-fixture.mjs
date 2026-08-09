#!/usr/bin/env node

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ORACLE = process.argv.includes('--oracle');
const FILE = ORACLE ? 'longmemeval_oracle.json' : 'longmemeval_s_cleaned.json';
const URL = `https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/${FILE}`;
const CACHE = join(homedir(), '.cache', 'metalmind-bench', 'longmemeval');
const NOTES_DIR = join(CACHE, ORACLE ? 'notes-oracle' : 'notes');
const QUESTIONS_PATH = join(CACHE, ORACLE ? 'questions-oracle.json' : 'questions.json');

async function download() {
  const target = join(CACHE, FILE);
  const existing = await stat(target).catch(() => null);
  if (existing && existing.size > 1_000_000) {
    process.stdout.write(`cached: ${target} (${(existing.size / 1e6).toFixed(0)} MB)\n`);
    return target;
  }
  process.stdout.write(`downloading ${URL}…\n`);
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await mkdir(CACHE, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  const size = (await stat(target)).size;
  process.stdout.write(`downloaded ${(size / 1e6).toFixed(0)} MB\n`);
  return target;
}

function sessionFilename(id) {
  return `session-${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
}

function renderSession(id, date, turns) {
  const lines = [`# Session ${id}`, '', `Date: ${date ?? 'unknown'}`, ''];
  for (const t of turns) {
    const role = t.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${role}`, '', String(t.content ?? '').trim(), '');
  }
  return lines.join('\n');
}

async function main() {
  const path = await download();
  process.stdout.write('parsing…\n');
  const data = JSON.parse(await readFile(path, 'utf8'));
  process.stdout.write(`${data.length} questions\n`);

  await mkdir(NOTES_DIR, { recursive: true });
  const seen = new Set();
  const questions = [];
  let written = 0;

  for (const q of data) {
    const ids = q.haystack_session_ids ?? [];
    const dates = q.haystack_dates ?? [];
    const sessions = q.haystack_sessions ?? [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      if (seen.has(id)) continue;
      seen.add(id);
      await writeFile(
        join(NOTES_DIR, sessionFilename(id)),
        renderSession(id, dates[i], sessions[i] ?? []),
        'utf8',
      );
      written += 1;
    }
    const answerIds = q.answer_session_ids ?? [];
    const abstention = String(q.question_id).endsWith('_abs') || answerIds.length === 0;
    questions.push({
      id: q.question_id,
      type: q.question_type,
      query: q.question,
      abstention,
      expected: abstention ? [] : answerIds.map(sessionFilename),
    });
  }

  await writeFile(QUESTIONS_PATH, `${JSON.stringify(questions, null, 2)}\n`, 'utf8');
  const abst = questions.filter((q) => q.abstention).length;
  process.stdout.write(
    `fixture ready: ${written} unique sessions → ${NOTES_DIR}\n` +
      `${questions.length} questions (${abst} abstention) → ${QUESTIONS_PATH}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
