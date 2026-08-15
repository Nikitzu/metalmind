import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parseCodeRef } from '../coderefs/coderefs.js';
import { type DateArg, resolveDate } from './daily.js';
import { frontmatterString, looksLikeNoteStem, parseFrontmatter } from './frontmatter.js';

export type ScribeKind =
  | 'plan'
  | 'learning'
  | 'work'
  | 'daily'
  | 'moc'
  | 'inbox'
  | 'memory'
  | 'personal';

export const KIND_DIRS: Record<ScribeKind, string> = {
  plan: 'Plans',
  learning: 'Learnings',
  work: 'Work',
  daily: 'Daily',
  moc: 'Work/MOCs',
  inbox: 'Inbox',
  memory: 'Memory',
  personal: 'Personal',
};

const LINKED_NOTES_HEADING = '## Linked notes';

export interface ScribeOpts {
  vaultRoot: string;
  now?: () => Date;
}

export interface CreateOpts {
  kind: ScribeKind;
  title: string;
  body: string;
  project?: string;
  tags?: string[];
  slug?: string;
  /** Explicit acknowledgement of a non-today daily-note date. Required for
   *  any daily-targeted mutating op when target date ≠ today. Accepts the
   *  same shape as `metalmind atium`: today | tomorrow | next-workday |
   *  YYYY-MM-DD. */
  date?: DateArg;
  moc?: boolean;
  dryRun?: boolean;
  code?: string[];
}

export interface DailyDateOpts {
  /** See {@link CreateOpts.date}. */
  date?: DateArg;
}

export interface PatchOpts {
  section?: string;
  body?: string;
  find?: string;
  replace?: string;
  occurrence?: number;
  date?: DateArg;
  dryRun?: boolean;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DAILY_FILE_RE = /Daily[/\\](\d{4}-\d{2}-\d{2})\.md$/;

function dailyDateFromPath(abs: string): string | null {
  const m = DAILY_FILE_RE.exec(abs);
  return m?.[1] ?? null;
}

export function assertDailyDateAck(
  abs: string,
  dateArg: DateArg | undefined,
  now: Date,
  action: string,
): void {
  const fileDate = dailyDateFromPath(abs);
  if (!fileDate) return;
  const today = isoDate(now);
  if (fileDate === today) return;
  if (dateArg !== undefined) {
    const resolved = resolveDate(dateArg, now);
    if (resolved === fileDate) return;
    throw new Error(
      `--date '${dateArg}' resolves to ${resolved}, but target daily note is ${fileDate}. ` +
        `Pass --date ${fileDate} to acknowledge the target date explicitly.`,
    );
  }
  throw new Error(
    `refusing to ${action} daily note for ${fileDate} (today is ${today}). ` +
      `Pass --date ${fileDate} to acknowledge the target date explicitly, or use ` +
      `'metalmind atium add --date ${fileDate}' (canonical path for daily action items).`,
  );
}

export function resolveNotePath(input: string, vaultRoot: string): string {
  const m = /^([a-z]+):(.+)$/.exec(input);
  let candidate: string;
  if (m) {
    const kind = m[1] as ScribeKind;
    const slug = m[2] ?? '';
    const dir = KIND_DIRS[kind];
    if (!dir)
      throw new Error(`unknown kind '${kind}' (valid: ${Object.keys(KIND_DIRS).join(', ')})`);
    const filename = slug.endsWith('.md') ? slug : `${slug}.md`;
    candidate = join(vaultRoot, dir, filename);
  } else if (input.startsWith('/')) {
    candidate = input;
  } else {
    candidate = join(vaultRoot, input.endsWith('.md') ? input : `${input}.md`);
  }
  const abs = resolve(candidate);
  const root = resolve(vaultRoot);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path escapes vault: ${input}`);
  }
  return abs;
}

export async function assertRealPathContained(abs: string, vaultRoot: string): Promise<void> {
  const link = await lstat(abs).catch(() => null);
  if (link?.isSymbolicLink()) {
    throw new Error(`refusing to follow symlink inside the vault: ${abs}`);
  }
  const root = await realpath(vaultRoot).catch(() => resolve(vaultRoot));
  const parentReal = await realpath(dirname(abs)).catch(() => null);
  if (parentReal === null) return;
  const real = join(parentReal, basename(abs));
  if (real !== root && !real.startsWith(root + sep)) {
    throw new Error(`path escapes vault (via symlink): ${abs}`);
  }
}

function filenameFor(kind: ScribeKind, slug: string, now: Date, dailyDate?: string): string {
  if (kind === 'daily') return `${dailyDate ?? isoDate(now)}.md`;
  if (kind === 'plan')
    return /^\d{4}-\d{2}-\d{2}-/.test(slug) ? `${slug}.md` : `${isoDate(now)}-${slug}.md`;
  return `${slug}.md`;
}

function yamlScalar(v: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control chars must force quoting - an unquoted newline injects arbitrary frontmatter keys
  if (/[:#[\]{}&*!|>'"%@`]/.test(v) || /[\u0000-\u001f]/.test(v) || /^\s|\s$/.test(v) || v === '')
    return JSON.stringify(v);
  return v;
}

export function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}: [${v.map((x) => JSON.stringify(String(x))).join(', ')}]`);
    } else {
      lines.push(`${k}: ${yamlScalar(String(v))}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

export function rewriteFrontmatterField(source: string, key: string, value: string): string {
  const { bodyStart } = parseFrontmatter(source);
  if (bodyStart === 0) {
    return buildFrontmatter({ [key]: value }) + source;
  }
  const head = source.slice(0, bodyStart - 5);
  const tail = source.slice(bodyStart - 5);
  const re = new RegExp(`(^|\\n)${key}:[^\\n]*`);
  if (re.test(head)) return head.replace(re, `$1${key}: ${value}`) + tail;
  return `${head}\n${key}: ${value}${tail}`;
}

function removeFrontmatterField(source: string, key: string): string {
  const { bodyStart } = parseFrontmatter(source);
  if (bodyStart === 0) return source;
  const head = source.slice(0, bodyStart - 5);
  const tail = source.slice(bodyStart - 5);
  return head.replace(new RegExp(`(^|\\n)${key}:[^\\n]*`), '') + tail;
}

function mocPathFor(vaultRoot: string, project: string): string {
  return join(vaultRoot, KIND_DIRS.moc, `${project}.md`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function appendMocLink(
  vaultRoot: string,
  project: string,
  relPath: string,
  title: string,
): Promise<void> {
  const moc = mocPathFor(vaultRoot, project);
  const link = `- [[${relPath.replace(/\.md$/, '')}]] - ${title}`;
  if (!(await exists(moc))) {
    const scaffold =
      buildFrontmatter({ project, kind: 'moc', created: isoDate(new Date()) }) +
      `\n# ${project} - MOC\n\n${LINKED_NOTES_HEADING}\n\n${link}\n`;
    await mkdir(dirname(moc), { recursive: true });
    await writeFile(moc, scaffold, 'utf8');
    return;
  }
  const raw = await readFile(moc, 'utf8');
  if (raw.includes(link)) return;
  if (raw.includes(LINKED_NOTES_HEADING)) {
    const updated = raw.replace(LINKED_NOTES_HEADING, `${LINKED_NOTES_HEADING}\n\n${link}`);
    await writeFile(moc, updated, 'utf8');
    return;
  }
  await writeFile(moc, `${raw.trimEnd()}\n\n${LINKED_NOTES_HEADING}\n\n${link}\n`, 'utf8');
}

async function stripMocLink(vaultRoot: string, project: string, relPath: string): Promise<void> {
  const moc = mocPathFor(vaultRoot, project);
  if (!(await exists(moc))) return;
  const raw = await readFile(moc, 'utf8');
  const slug = relPath.replace(/\.md$/, '');
  const pattern = new RegExp(
    `^- \\[\\[${slug.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]\\] -.*\\n?`,
    'gm',
  );
  const updated = raw.replace(pattern, '');
  if (updated !== raw) await writeFile(moc, updated, 'utf8');
}

export async function scribeCreate(
  opts: CreateOpts,
  ctx: ScribeOpts,
): Promise<{ path: string; relPath: string; created: boolean }> {
  assertCodeRefs(opts.code);
  const now = ctx.now ? ctx.now() : new Date();
  let dailyDate: string | undefined;
  if (opts.kind === 'daily') {
    const today = isoDate(now);
    if (opts.date !== undefined) {
      dailyDate = resolveDate(opts.date, now);
      if (opts.slug && opts.slug !== dailyDate) {
        throw new Error(
          `--slug '${opts.slug}' conflicts with --date '${opts.date}' (resolves to ${dailyDate}). ` +
            `Drop --slug for daily kind - --date is the canonical knob for the target date.`,
        );
      }
    } else if (opts.slug && opts.slug !== today) {
      throw new Error(
        `for kind=daily on a non-today date, use --date '${opts.slug}' to acknowledge it explicitly, ` +
          `or 'metalmind atium new --date ${opts.slug}' (canonical path for future daily notes).`,
      );
    }
  }
  const slug = opts.slug ? slugify(opts.slug) : slugify(opts.title);
  if (!slug && opts.kind !== 'daily')
    throw new Error('could not derive slug from title; pass --slug');
  const dir = join(ctx.vaultRoot, KIND_DIRS[opts.kind]);
  const filename = filenameFor(opts.kind, slug, now, dailyDate);
  const abs = join(dir, filename);
  const relPath = relative(ctx.vaultRoot, abs);

  if (opts.dryRun) return { path: abs, relPath, created: false };

  const frontmatter = buildFrontmatter({
    project: opts.project,
    kind: opts.kind,
    title: opts.title,
    tags: opts.tags,
    created: isoDate(now),
    updated: isoDate(now),
    status: 'active',
    code: opts.code,
  });
  const body = opts.body.endsWith('\n') ? opts.body : `${opts.body}\n`;
  const content = `${frontmatter}# ${opts.title}\n\n${body}`;

  await mkdir(dir, { recursive: true });

  if (opts.kind === 'daily' && (await exists(abs))) {
    const existing = await readFile(abs, 'utf8');
    const section = `\n\n## ${opts.title}\n\n${body}`;
    await writeFile(abs, existing.trimEnd() + section, 'utf8');
  } else if (await exists(abs)) {
    throw new Error(`note already exists at ${relPath} - use scribe update to modify`);
  } else {
    await writeFile(abs, content, 'utf8');
  }

  if (opts.moc !== false && opts.project) {
    await appendMocLink(ctx.vaultRoot, opts.project, relPath, opts.title);
  }

  return { path: abs, relPath, created: true };
}

function assertCodeRefs(code: string[] | undefined): void {
  for (const ref of code ?? []) {
    if (!parseCodeRef(ref)) {
      throw new Error(`malformed code ref: ${ref} (expected repo#symbol)`);
    }
  }
}

export async function scribeUpdate(
  notePath: string,
  body: string,
  ctx: ScribeOpts,
  opts: { dryRun?: boolean; date?: DateArg; code?: string[] } = {},
): Promise<{ path: string }> {
  assertCodeRefs(opts.code);
  const abs = resolveNotePath(notePath, ctx.vaultRoot);
  await assertRealPathContained(abs, ctx.vaultRoot);
  if (!(await exists(abs))) throw new Error(`note not found: ${abs}`);
  const now = ctx.now ? ctx.now() : new Date();
  assertDailyDateAck(abs, opts.date, now, 'update');
  if (opts.dryRun) return { path: abs };
  const raw = await readFile(abs, 'utf8');
  let bumped = rewriteFrontmatterField(raw, 'updated', isoDate(now));
  if (opts.code) {
    bumped =
      opts.code.length > 0
        ? rewriteFrontmatterField(
            bumped,
            'code',
            `[${opts.code.map((c) => JSON.stringify(c)).join(', ')}]`,
          )
        : removeFrontmatterField(bumped, 'code');
  }
  const next = body.trim() ? `${bumped.trimEnd()}\n\n${body.trim()}\n` : bumped;
  await writeFile(abs, next, 'utf8');
  return { path: abs };
}

export async function scribePatch(
  notePath: string,
  opts: PatchOpts,
  ctx: ScribeOpts,
): Promise<{ path: string }> {
  const findMode = opts.find !== undefined || opts.replace !== undefined;
  if (findMode && opts.section !== undefined) {
    throw new Error('pass either --section (with body) or --find/--replace, not both');
  }
  const abs = resolveNotePath(notePath, ctx.vaultRoot);
  await assertRealPathContained(abs, ctx.vaultRoot);
  if (!(await exists(abs))) throw new Error(`note not found: ${abs}`);
  const now = ctx.now ? ctx.now() : new Date();
  assertDailyDateAck(abs, opts.date, now, 'patch');
  const raw = await readFile(abs, 'utf8');

  if (findMode) {
    if (opts.find === undefined || opts.find === '') throw new Error('--find requires text');
    if (opts.replace === undefined) throw new Error('--find requires --replace (may be empty)');
    const { bodyStart } = parseFrontmatter(raw);
    const body = raw.slice(bodyStart);
    const indices: number[] = [];
    for (let i = body.indexOf(opts.find); i !== -1; i = body.indexOf(opts.find, i + 1)) {
      indices.push(i);
    }
    if (indices.length === 0) throw new Error(`text not found in note body: ${opts.find}`);
    if (indices.length > 1 && opts.occurrence === undefined) {
      throw new Error(
        `--find matches ${indices.length} occurrences - pass --occurrence N (1-indexed)`,
      );
    }
    const at = indices[(opts.occurrence ?? 1) - 1];
    if (at === undefined)
      throw new Error(`--occurrence ${opts.occurrence} out of range (1..${indices.length})`);
    if (opts.dryRun) return { path: abs };
    const newBody = body.slice(0, at) + opts.replace + body.slice(at + opts.find.length);
    const bumped = rewriteFrontmatterField(
      raw.slice(0, bodyStart) + newBody,
      'updated',
      isoDate(now),
    );
    await writeFile(abs, bumped, 'utf8');
    return { path: abs };
  }

  const { section, body: sectionBody } = opts;
  if (section === undefined) {
    throw new Error('pass either --section (with body) or --find/--replace');
  }
  if (sectionBody === undefined || !sectionBody.trim())
    throw new Error('--section requires a non-empty body');
  const headingRe = new RegExp(
    `^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
    'gm',
  );
  const matches = [...raw.matchAll(headingRe)];
  if (matches.length === 0) throw new Error(`section '## ${opts.section}' not found`);
  if (matches.length > 1 && opts.occurrence === undefined) {
    throw new Error(
      `section '## ${opts.section}' has ${matches.length} occurrences - pass --occurrence N (1-indexed)`,
    );
  }
  const target = matches[(opts.occurrence ?? 1) - 1];
  if (!target)
    throw new Error(`--occurrence ${opts.occurrence} out of range (1..${matches.length})`);
  const start = target.index ?? 0;
  const afterHeading = start + target[0].length;
  const nextHeading = raw.slice(afterHeading).search(/\n##\s/);
  const end = nextHeading < 0 ? raw.length : afterHeading + nextHeading;
  const replaced = `${raw.slice(0, afterHeading)}\n\n${sectionBody.trim()}\n${raw.slice(end)}`;
  if (opts.dryRun) return { path: abs };
  const bumped = rewriteFrontmatterField(replaced, 'updated', isoDate(now));
  await writeFile(abs, bumped, 'utf8');
  return { path: abs };
}

export interface SupersedeOpts {
  force?: boolean;
  date?: DateArg;
  dryRun?: boolean;
}

export async function scribeSupersede(
  oldNote: string,
  newNote: string,
  ctx: ScribeOpts,
  opts: SupersedeOpts = {},
): Promise<{ oldPath: string; newPath: string; oldStem: string; newStem: string }> {
  const oldAbs = resolveNotePath(oldNote, ctx.vaultRoot);
  const newAbs = resolveNotePath(newNote, ctx.vaultRoot);
  await assertRealPathContained(oldAbs, ctx.vaultRoot);
  await assertRealPathContained(newAbs, ctx.vaultRoot);
  if (!(await exists(oldAbs))) throw new Error(`note not found: ${oldAbs}`);
  if (!(await exists(newAbs))) throw new Error(`note not found: ${newAbs}`);
  if (oldAbs === newAbs) throw new Error('a note cannot supersede itself');

  const now = ctx.now ? ctx.now() : new Date();
  const oldDaily = dailyDateFromPath(oldAbs);
  const newDaily = dailyDateFromPath(newAbs);
  const today = isoDate(now);
  if (oldDaily && newDaily && oldDaily !== newDaily && oldDaily !== today && newDaily !== today) {
    throw new Error(
      `cannot supersede between two non-today daily notes (${oldDaily}, ${newDaily}) - ` +
        'no single --date acknowledges both. Move the content instead.',
    );
  }
  assertDailyDateAck(oldAbs, opts.date, now, 'supersede');
  assertDailyDateAck(newAbs, opts.date, now, 'supersede');

  const oldRaw = await readFile(oldAbs, 'utf8');
  const { fm } = parseFrontmatter(oldRaw);
  const existing = frontmatterString(fm, 'superseded_by');
  if (existing && !opts.force && looksLikeNoteStem(existing)) {
    throw new Error(
      `already superseded by ${existing} - pass --force to re-point at the new successor`,
    );
  }

  const oldStem = basename(oldAbs, '.md');
  const newStem = basename(newAbs, '.md');
  if (/[\r\n]/.test(oldStem) || /[\r\n]/.test(newStem)) {
    throw new Error('note filename contains a newline - refusing to write it into frontmatter');
  }
  if (opts.dryRun) return { oldPath: oldAbs, newPath: newAbs, oldStem, newStem };

  const stamp = isoDate(now);
  let oldNext = rewriteFrontmatterField(oldRaw, 'status', 'superseded');
  oldNext = rewriteFrontmatterField(oldNext, 'superseded_by', yamlScalar(newStem));
  oldNext = rewriteFrontmatterField(oldNext, 'superseded_at', stamp);
  oldNext = rewriteFrontmatterField(oldNext, 'updated', stamp);
  await writeFile(oldAbs, oldNext, 'utf8');

  const newRaw = await readFile(newAbs, 'utf8');
  let newNext = rewriteFrontmatterField(newRaw, 'supersedes', yamlScalar(oldStem));
  newNext = rewriteFrontmatterField(newNext, 'updated', stamp);
  await writeFile(newAbs, newNext, 'utf8');

  return { oldPath: oldAbs, newPath: newAbs, oldStem, newStem };
}

export async function scribeDelete(
  notePath: string,
  ctx: ScribeOpts,
  opts: { hard?: boolean; dryRun?: boolean; date?: DateArg } = {},
): Promise<{ path: string; to?: string }> {
  const abs = resolveNotePath(notePath, ctx.vaultRoot);
  await assertRealPathContained(abs, ctx.vaultRoot);
  if (!(await exists(abs))) throw new Error(`note not found: ${abs}`);
  const now = ctx.now ? ctx.now() : new Date();
  assertDailyDateAck(abs, opts.date, now, 'delete');
  if (opts.dryRun) return { path: abs };
  if (opts.hard) {
    await rm(abs);
    return { path: abs };
  }
  const trashDir = join(ctx.vaultRoot, '.trash');
  await mkdir(trashDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dest = join(trashDir, `${stamp}__${basename(abs)}`);
  await rename(abs, dest);
  const relPath = relative(ctx.vaultRoot, abs);
  const project = await projectOf(dest);
  if (project) await stripMocLink(ctx.vaultRoot, project, relPath);
  return { path: abs, to: dest };
}

export interface ArchiveResult {
  path: string;
  to: string;
  /** Number of [[wikilink]] occurrences rewritten across the vault. */
  backlinksRewritten: number;
  /** Files (other than the archived note itself) that had at least one rewrite. */
  filesTouched: string[];
}

export async function scribeArchive(
  notePath: string,
  ctx: ScribeOpts,
  opts: { dryRun?: boolean; date?: DateArg } = {},
): Promise<ArchiveResult> {
  const abs = resolveNotePath(notePath, ctx.vaultRoot);
  await assertRealPathContained(abs, ctx.vaultRoot);
  if (!(await exists(abs))) throw new Error(`note not found: ${abs}`);
  const now = ctx.now ? ctx.now() : new Date();
  assertDailyDateAck(abs, opts.date, now, 'archive');
  const archiveRoot = join(ctx.vaultRoot, 'Archive');
  const rel = relative(ctx.vaultRoot, abs);
  const dest = join(archiveRoot, rel);

  // Rewrite [[wikilinks]] across the vault to point at the new (Archive/)
  // path before moving the file. Basename-only wikilinks (e.g. [[foo]])
  // survive an archive unchanged because the filename doesn't change;
  // path-prefixed wikilinks (e.g. [[Plans/foo]]) need rewriting to
  // [[Archive/Plans/foo]] so Obsidian's strict-path resolver still finds
  // the note. This closes the v0.8.1 gotcha where archiving a referenced
  // plan left dangling links scattered across the MOC + companion notes.
  const oldRel = rel.replace(/\.md$/, '');
  const newRel = relative(ctx.vaultRoot, dest).replace(/\.md$/, '');
  const touched: string[] = [];
  let total = 0;
  const files = await walkMarkdown(ctx.vaultRoot);
  for (const f of files) {
    if (f === abs) continue;
    const raw = await readFile(f, 'utf8');
    const { text, count } = rewriteBacklinks(raw, oldRel, newRel);
    if (count === 0) continue;
    total += count;
    touched.push(f);
    if (!opts.dryRun) await writeFile(f, text, 'utf8');
  }

  if (opts.dryRun) return { path: abs, to: dest, backlinksRewritten: total, filesTouched: touched };

  await mkdir(dirname(dest), { recursive: true });
  const raw = await readFile(abs, 'utf8');
  const withStatus = rewriteFrontmatterField(raw, 'status', 'archived');
  const bumped = rewriteFrontmatterField(withStatus, 'updated', isoDate(now));
  await writeFile(dest, bumped, 'utf8');
  await rm(abs);
  return { path: abs, to: dest, backlinksRewritten: total, filesTouched: touched };
}

async function projectOf(abs: string): Promise<string | null> {
  try {
    const raw = await readFile(abs, 'utf8');
    return frontmatterString(parseFrontmatter(raw).fm, 'project');
  } catch {
    return null;
  }
}

export interface ListEntry {
  path: string;
  relPath: string;
  kind: ScribeKind | null;
  project: string | null;
  title: string | null;
  status: string | null;
}

export async function scribeList(
  ctx: ScribeOpts,
  filter: { project?: string; kind?: ScribeKind } = {},
): Promise<ListEntry[]> {
  const dirs: ScribeKind[] = filter.kind ? [filter.kind] : (Object.keys(KIND_DIRS) as ScribeKind[]);
  const out: ListEntry[] = [];
  for (const kind of dirs) {
    const dir = join(ctx.vaultRoot, KIND_DIRS[kind]);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const abs = join(dir, name);
      const s = await stat(abs).catch(() => null);
      if (!s?.isFile()) continue;
      const raw = await readFile(abs, 'utf8').catch(() => '');
      const { fm } = parseFrontmatter(raw);
      if (filter.project && frontmatterString(fm, 'project') !== filter.project) continue;
      out.push({
        path: abs,
        relPath: relative(ctx.vaultRoot, abs),
        kind,
        project: frontmatterString(fm, 'project'),
        title: frontmatterString(fm, 'title'),
        status: frontmatterString(fm, 'status'),
      });
    }
  }
  return out;
}

export async function scribeShow(notePath: string, ctx: ScribeOpts): Promise<string> {
  const abs = resolveNotePath(notePath, ctx.vaultRoot);
  await assertRealPathContained(abs, ctx.vaultRoot);
  if (!(await exists(abs))) throw new Error(`note not found: ${abs}`);
  return readFile(abs, 'utf8');
}

export interface RenameResult {
  from: string;
  to: string;
  backlinksRewritten: number;
  filesTouched: string[];
}

async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [root];
  while (queue.length) {
    const dir = queue.pop();
    if (!dir) continue;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'Archive' || entry.name === 'node_modules') continue;
        queue.push(abs);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(abs);
      }
    }
  }
  return out;
}

/** Rewrite wikilinks `[[old]]`, `[[old#h]]`, `[[old|alias]]`, `[[old#h|alias]]`
 *  and path variants `[[dir/old]]` to point at the new slug. Returns the
 *  rewritten text and a count of replacements. */
export function rewriteBacklinks(
  source: string,
  oldSlug: string,
  newSlug: string,
): { text: string; count: number } {
  const oldBase = oldSlug.split('/').pop() ?? oldSlug;
  const newBase = newSlug.split('/').pop() ?? newSlug;
  let count = 0;
  const re = /\[\[([^\]|#]+?)([|#][^\]]*)?\]\]/g;
  const text = source.replace(re, (match, target: string, suffix: string | undefined) => {
    const base = target.split('/').pop() ?? target;
    if (target === oldSlug) {
      count++;
      return `[[${newSlug}${suffix ?? ''}]]`;
    }
    if (base === oldBase) {
      count++;
      const prefix = target.slice(0, target.length - base.length);
      return `[[${prefix}${newBase}${suffix ?? ''}]]`;
    }
    return match;
  });
  return { text, count };
}

export async function scribeRename(
  from: string,
  to: string,
  ctx: ScribeOpts,
  opts: { dryRun?: boolean; date?: DateArg } = {},
): Promise<RenameResult> {
  const absFrom = resolveNotePath(from, ctx.vaultRoot);
  if (!(await exists(absFrom))) throw new Error(`source note not found: ${absFrom}`);
  const bareSlug = !/^[a-z]+:/.test(to) && !to.includes('/');
  const absTo = bareSlug
    ? join(dirname(absFrom), to.endsWith('.md') ? to : `${to}.md`)
    : resolveNotePath(to, ctx.vaultRoot);
  if (absFrom === absTo) throw new Error('from and to resolve to the same path');
  if (await exists(absTo)) throw new Error(`destination already exists: ${absTo}`);
  const renameNow = ctx.now ? ctx.now() : new Date();
  assertDailyDateAck(absFrom, opts.date, renameNow, 'rename');
  assertDailyDateAck(absTo, opts.date, renameNow, 'rename');

  const oldRel = relative(ctx.vaultRoot, absFrom).replace(/\.md$/, '');
  const newRel = relative(ctx.vaultRoot, absTo).replace(/\.md$/, '');

  const touched: string[] = [];
  let total = 0;
  const files = await walkMarkdown(ctx.vaultRoot);
  for (const f of files) {
    if (f === absFrom) continue;
    const raw = await readFile(f, 'utf8');
    const { text, count } = rewriteBacklinks(raw, oldRel, newRel);
    if (count === 0) continue;
    total += count;
    touched.push(f);
    if (!opts.dryRun) await writeFile(f, text, 'utf8');
  }

  if (!opts.dryRun) {
    await mkdir(dirname(absTo), { recursive: true });
    const raw = await readFile(absFrom, 'utf8');
    const bumped = rewriteFrontmatterField(raw, 'updated', isoDate(renameNow));
    await writeFile(absTo, bumped, 'utf8');
    await rm(absFrom);
  }

  return { from: absFrom, to: absTo, backlinksRewritten: total, filesTouched: touched };
}
