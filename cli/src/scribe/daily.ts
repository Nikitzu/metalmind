import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const ACTION_ITEMS_HEADING = '## Action Items';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DateArg = 'today' | 'tomorrow' | 'next-workday' | string;

export interface DailyOpts {
  vaultRoot: string;
  now?: () => Date;
}

export interface DailyNewOpts {
  date?: DateArg;
  from?: DateArg;
  dryRun?: boolean;
}

export interface DailyAddOpts {
  date?: DateArg;
  dryRun?: boolean;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveDate(arg: DateArg | undefined, now: Date): string {
  const value = arg ?? 'today';
  if (DATE_RE.test(value)) return value;
  const d = new Date(now);
  if (value === 'today') return isoDate(d);
  if (value === 'tomorrow') {
    d.setUTCDate(d.getUTCDate() + 1);
    return isoDate(d);
  }
  if (value === 'next-workday') {
    do {
      d.setUTCDate(d.getUTCDate() + 1);
    } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return isoDate(d);
  }
  throw new Error(
    `invalid --date '${value}' (valid: today, tomorrow, next-workday, or YYYY-MM-DD)`,
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function dailyPath(vaultRoot: string, date: string): string {
  return join(vaultRoot, 'Daily', `${date}.md`);
}

function frontmatter(date: string, now: string): string {
  return [
    '---',
    'kind: daily',
    `title: ${date}`,
    `created: ${now}`,
    `updated: ${now}`,
    'status: active',
    '---',
    '',
  ].join('\n');
}

function emptyNote(date: string, now: string, items: string[] = []): string {
  const bullets = items.length === 0 ? '- ' : items.map((i) => `- ${i}`).join('\n');
  return `${frontmatter(date, now)}# ${date}\n\n${ACTION_ITEMS_HEADING}\n\n${bullets}\n`;
}

export function extractUncheckedItems(source: string): string[] {
  const lines = source.split('\n');
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+Action\s+Items\s*$/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) break;
    if (!inSection) continue;
    const m = /^-\s+\[\s\]\s+(.+)$/.exec(line);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

export async function dailyNew(
  opts: DailyNewOpts,
  ctx: DailyOpts,
): Promise<{ path: string; relPath: string; carried: number }> {
  const now = ctx.now ? ctx.now() : new Date();
  const date = resolveDate(opts.date, now);
  const abs = dailyPath(ctx.vaultRoot, date);
  const relPath = relative(ctx.vaultRoot, abs);

  if (await fileExists(abs)) {
    throw new Error(
      `daily note already exists: ${relPath} - use 'metalmind atium add' or 'metalmind daily add' to append`,
    );
  }

  let carried: string[] = [];
  if (opts.from) {
    const fromDate = resolveDate(opts.from, now);
    const fromAbs = dailyPath(ctx.vaultRoot, fromDate);
    if (!(await fileExists(fromAbs))) {
      throw new Error(`--from source not found: Daily/${fromDate}.md`);
    }
    const raw = await readFile(fromAbs, 'utf8');
    carried = extractUncheckedItems(raw);
  }

  if (opts.dryRun) return { path: abs, relPath, carried: carried.length };

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, emptyNote(date, isoDate(now), carried), 'utf8');
  return { path: abs, relPath, carried: carried.length };
}

export async function dailyAdd(
  item: string,
  opts: DailyAddOpts,
  ctx: DailyOpts,
): Promise<{ path: string; relPath: string; created: boolean }> {
  const trimmed = item.trim();
  if (!trimmed) throw new Error('item is empty');

  const now = ctx.now ? ctx.now() : new Date();
  const date = resolveDate(opts.date, now);
  const abs = dailyPath(ctx.vaultRoot, date);
  const relPath = relative(ctx.vaultRoot, abs);

  if (opts.dryRun) {
    return { path: abs, relPath, created: !(await fileExists(abs)) };
  }

  if (!(await fileExists(abs))) {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, emptyNote(date, isoDate(now), [trimmed]), 'utf8');
    return { path: abs, relPath, created: true };
  }

  const raw = await readFile(abs, 'utf8');
  const lines = raw.split('\n');
  const headingIdx = lines.findIndex((l) => /^##\s+Action\s+Items\s*$/.test(l));

  if (headingIdx < 0) {
    const next = `${raw.trimEnd()}\n\n${ACTION_ITEMS_HEADING}\n\n- ${trimmed}\n`;
    await writeFile(abs, next, 'utf8');
    return { path: abs, relPath, created: false };
  }

  let insertAt = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] ?? '')) {
      insertAt = i;
      break;
    }
  }
  let last = insertAt - 1;
  while (last > headingIdx && (lines[last] ?? '').trim() === '') last--;

  const bullet = `- ${trimmed}`;
  const before = lines.slice(0, last + 1);
  const after = lines.slice(last + 1);
  const combined = [...before, bullet, ...after];

  const head = combined.slice();
  if (head[0] === '---') {
    const dashIdx = head.indexOf('---', 1);
    if (dashIdx > 0) {
      const updatedIdx = head.findIndex((l, i) => i > 0 && i < dashIdx && l.startsWith('updated:'));
      if (updatedIdx > 0) head[updatedIdx] = `updated: ${isoDate(now)}`;
      await writeFile(abs, head.join('\n'), 'utf8');
      return { path: abs, relPath, created: false };
    }
  }

  await writeFile(abs, combined.join('\n'), 'utf8');
  return { path: abs, relPath, created: false };
}
