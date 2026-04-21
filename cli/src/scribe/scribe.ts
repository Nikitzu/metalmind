import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

export type ScribeKind = 'plan' | 'learning' | 'work' | 'daily' | 'moc' | 'inbox';

export const KIND_DIRS: Record<ScribeKind, string> = {
  plan: 'Plans',
  learning: 'Learnings',
  work: 'Work',
  daily: 'Daily',
  moc: 'Work/MOCs',
  inbox: 'Inbox',
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
  moc?: boolean;
  dryRun?: boolean;
}

export interface PatchOpts {
  section: string;
  body: string;
  occurrence?: number;
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

export function resolveNotePath(input: string, vaultRoot: string): string {
  const m = /^([a-z]+):(.+)$/.exec(input);
  if (m) {
    const kind = m[1] as ScribeKind;
    const slug = m[2] ?? '';
    const dir = KIND_DIRS[kind];
    if (!dir) throw new Error(`unknown kind '${kind}' (valid: ${Object.keys(KIND_DIRS).join(', ')})`);
    const filename = slug.endsWith('.md') ? slug : `${slug}.md`;
    return join(vaultRoot, dir, filename);
  }
  if (input.startsWith('/')) return input;
  return join(vaultRoot, input);
}

function filenameFor(kind: ScribeKind, slug: string, now: Date): string {
  if (kind === 'daily') return `${isoDate(now)}.md`;
  if (kind === 'plan') return `${isoDate(now)}-${slug}.md`;
  return `${slug}.md`;
}

function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}: [${v.map((x) => JSON.stringify(String(x))).join(', ')}]`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function parseFrontmatter(source: string): { fm: Record<string, string>; bodyStart: number } {
  if (!source.startsWith('---\n')) return { fm: {}, bodyStart: 0 };
  const end = source.indexOf('\n---\n', 4);
  if (end < 0) return { fm: {}, bodyStart: 0 };
  const block = source.slice(4, end);
  const fm: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) fm[k] = v;
  }
  return { fm, bodyStart: end + 5 };
}

function rewriteFrontmatterField(source: string, key: string, value: string): string {
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
  const link = `- [[${relPath.replace(/\.md$/, '')}]] — ${title}`;
  if (!(await exists(moc))) {
    const scaffold =
      buildFrontmatter({ project, kind: 'moc', created: isoDate(new Date()) }) +
      `\n# ${project} — MOC\n\n${LINKED_NOTES_HEADING}\n\n${link}\n`;
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
    `^- \\[\\[${slug.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]\\] —.*\\n?`,
    'gm',
  );
  const updated = raw.replace(pattern, '');
  if (updated !== raw) await writeFile(moc, updated, 'utf8');
}

export async function scribeCreate(
  opts: CreateOpts,
  ctx: ScribeOpts,
): Promise<{ path: string; relPath: string; created: boolean }> {
  const now = ctx.now ? ctx.now() : new Date();
  const slug = opts.slug ? slugify(opts.slug) : slugify(opts.title);
  if (!slug && opts.kind !== 'daily')
    throw new Error('could not derive slug from title; pass --slug');
  const dir = join(ctx.vaultRoot, KIND_DIRS[opts.kind]);
  const filename = filenameFor(opts.kind, slug, now);
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
  });
  const body = opts.body.endsWith('\n') ? opts.body : `${opts.body}\n`;
  const content = `${frontmatter}# ${opts.title}\n\n${body}`;

  await mkdir(dir, { recursive: true });

  if (opts.kind === 'daily' && (await exists(abs))) {
    const existing = await readFile(abs, 'utf8');
    const section = `\n\n## ${opts.title}\n\n${body}`;
    await writeFile(abs, existing.trimEnd() + section, 'utf8');
  } else if (await exists(abs)) {
    throw new Error(`note already exists at ${relPath} — use scribe update to modify`);
  } else {
    await writeFile(abs, content, 'utf8');
  }

  if (opts.moc !== false && opts.project) {
    await appendMocLink(ctx.vaultRoot, opts.project, relPath, opts.title);
  }

  return { path: abs, relPath, created: true };
}

export async function scribeUpdate(
  notePath: string,
  body: string,
  ctx: ScribeOpts,
  opts: { dryRun?: boolean } = {},
): Promise<{ path: string }> {
  const abs = resolveNotePath(notePath, ctx.vaultRoot);
  if (!(await exists(abs))) throw new Error(`note not found: ${abs}`);
  if (opts.dryRun) return { path: abs };
  const raw = await readFile(abs, 'utf8');
  const now = ctx.now ? ctx.now() : new Date();
  const bumped = rewriteFrontmatterField(raw, 'updated', isoDate(now));
  const appended = `${bumped.trimEnd()}\n\n${body.trim()}\n`;
  await writeFile(abs, appended, 'utf8');
  return { path: abs };
}

export async function scribePatch(
  notePath: string,
  opts: PatchOpts,
  ctx: ScribeOpts,
): Promise<{ path: string }> {
  const abs = resolveNotePath(notePath, ctx.vaultRoot);
  if (!(await exists(abs))) throw new Error(`note not found: ${abs}`);
  const raw = await readFile(abs, 'utf8');
  const headingRe = new RegExp(
    `^##\\s+${opts.section.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`,
    'gm',
  );
  const matches = [...raw.matchAll(headingRe)];
  if (matches.length === 0) throw new Error(`section '## ${opts.section}' not found`);
  if (matches.length > 1 && opts.occurrence === undefined) {
    throw new Error(
      `section '## ${opts.section}' has ${matches.length} occurrences — pass --occurrence N (1-indexed)`,
    );
  }
  const target = matches[(opts.occurrence ?? 1) - 1];
  if (!target)
    throw new Error(`--occurrence ${opts.occurrence} out of range (1..${matches.length})`);
  const start = target.index ?? 0;
  const afterHeading = start + target[0].length;
  const nextHeading = raw.slice(afterHeading).search(/\n##\s/);
  const end = nextHeading < 0 ? raw.length : afterHeading + nextHeading;
  const replaced = `${raw.slice(0, afterHeading)}\n\n${opts.body.trim()}\n${raw.slice(end)}`;
  if (opts.dryRun) return { path: abs };
  const now = ctx.now ? ctx.now() : new Date();
  const bumped = rewriteFrontmatterField(replaced, 'updated', isoDate(now));
  await writeFile(abs, bumped, 'utf8');
  return { path: abs };
}

export async function scribeDelete(
  notePath: string,
  ctx: ScribeOpts,
  opts: { hard?: boolean; dryRun?: boolean } = {},
): Promise<{ path: string; to?: string }> {
  const abs = resolveNotePath(notePath, ctx.vaultRoot);
  if (!(await exists(abs))) throw new Error(`note not found: ${abs}`);
  if (opts.dryRun) return { path: abs };
  if (opts.hard) {
    await rm(abs);
    return { path: abs };
  }
  const trashDir = join(ctx.vaultRoot, '.trash');
  await mkdir(trashDir, { recursive: true });
  const stamp = (ctx.now ? ctx.now() : new Date()).toISOString().replace(/[:.]/g, '-');
  const dest = join(trashDir, `${stamp}__${basename(abs)}`);
  await rename(abs, dest);
  const relPath = relative(ctx.vaultRoot, abs);
  const project = await projectOf(dest);
  if (project) await stripMocLink(ctx.vaultRoot, project, relPath);
  return { path: abs, to: dest };
}

export async function scribeArchive(
  notePath: string,
  ctx: ScribeOpts,
  opts: { dryRun?: boolean } = {},
): Promise<{ path: string; to: string }> {
  const abs = resolveNotePath(notePath, ctx.vaultRoot);
  if (!(await exists(abs))) throw new Error(`note not found: ${abs}`);
  const archiveRoot = join(ctx.vaultRoot, 'Archive');
  const rel = relative(ctx.vaultRoot, abs);
  const dest = join(archiveRoot, rel);
  if (opts.dryRun) return { path: abs, to: dest };
  await mkdir(dirname(dest), { recursive: true });
  const raw = await readFile(abs, 'utf8');
  const now = ctx.now ? ctx.now() : new Date();
  const withStatus = rewriteFrontmatterField(raw, 'status', 'archived');
  const bumped = rewriteFrontmatterField(withStatus, 'updated', isoDate(now));
  await writeFile(dest, bumped, 'utf8');
  await rm(abs);
  return { path: abs, to: dest };
}

async function projectOf(abs: string): Promise<string | null> {
  try {
    const raw = await readFile(abs, 'utf8');
    return parseFrontmatter(raw).fm.project ?? null;
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
  const dirs: ScribeKind[] = filter.kind
    ? [filter.kind]
    : (Object.keys(KIND_DIRS) as ScribeKind[]);
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
      if (!s || !s.isFile()) continue;
      const raw = await readFile(abs, 'utf8').catch(() => '');
      const { fm } = parseFrontmatter(raw);
      if (filter.project && fm.project !== filter.project) continue;
      out.push({
        path: abs,
        relPath: relative(ctx.vaultRoot, abs),
        kind,
        project: fm.project ?? null,
        title: fm.title ?? null,
        status: fm.status ?? null,
      });
    }
  }
  return out;
}

export async function scribeShow(notePath: string, ctx: ScribeOpts): Promise<string> {
  const abs = resolveNotePath(notePath, ctx.vaultRoot);
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
  opts: { dryRun?: boolean } = {},
): Promise<RenameResult> {
  const absFrom = resolveNotePath(from, ctx.vaultRoot);
  if (!(await exists(absFrom))) throw new Error(`source note not found: ${absFrom}`);
  const absTo = resolveNotePath(to, ctx.vaultRoot);
  if (absFrom === absTo) throw new Error('from and to resolve to the same path');
  if (await exists(absTo)) throw new Error(`destination already exists: ${absTo}`);

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
    const now = ctx.now ? ctx.now() : new Date();
    const bumped = rewriteFrontmatterField(raw, 'updated', isoDate(now));
    await writeFile(absTo, bumped, 'utf8');
    await rm(absFrom);
  }

  return { from: absFrom, to: absTo, backlinksRewritten: total, filesTouched: touched };
}
