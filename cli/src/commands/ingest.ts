import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildFrontmatter, slugify } from '../scribe/scribe.js';

export interface IngestOptions {
  projectsDir?: string;
  vaultRoot: string;
  dryRun?: boolean;
  now?: () => Date;
}

export interface IngestResult {
  created: string[];
  updated: string[];
  skipped: string[];
  conflicts: string[];
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function splitNote(raw: string): { fm: string; body: string } {
  if (!raw.startsWith('---\n')) return { fm: '', body: raw };
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) return { fm: '', body: raw };
  return { fm: raw.slice(4, end), body: raw.slice(end + 5) };
}

function fmField(fm: string, key: string): string | null {
  const m = new RegExp(`^${key}:[ \\t]*(\\S.*)$`, 'm').exec(fm);
  return m?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null;
}

export async function ingestAutoMemory(opts: IngestOptions): Promise<IngestResult> {
  const projectsDir = opts.projectsDir ?? join(homedir(), '.claude', 'projects');
  const now = opts.now ? opts.now() : new Date();
  const today = now.toISOString().slice(0, 10);
  const result: IngestResult = { created: [], updated: [], skipped: [], conflicts: [] };

  let projectDirs: string[];
  try {
    projectDirs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return result;
  }

  for (const project of projectDirs.sort()) {
    const memDir = join(projectsDir, project, 'memory');
    let files: string[];
    try {
      files = (await readdir(memDir, { withFileTypes: true }))
        .filter((f) => f.isFile() && f.name.endsWith('.md') && f.name !== 'MEMORY.md')
        .map((f) => f.name);
    } catch {
      continue;
    }

    for (const file of files.sort()) {
      const sourcePath = join(memDir, file);
      let content = await readFile(sourcePath, 'utf8');
      if (!content.trim()) continue;
      if (!content.endsWith('\n')) content += '\n';
      const sourceHash = sha1(content);

      const projectSlug = slugify(project.replace(/^-/, ''));
      const topicSlug = slugify(file.replace(/\.md$/, ''));
      const rel = join('Memory', `auto-${projectSlug}-${topicSlug}.md`);
      const abs = join(opts.vaultRoot, rel);

      let existing: string | null = null;
      try {
        existing = await readFile(abs, 'utf8');
      } catch {
        existing = null;
      }

      if (existing === null) {
        result.created.push(rel);
        if (opts.dryRun) continue;
        const frontmatter = buildFrontmatter({
          kind: 'memory',
          title: file.replace(/\.md$/, ''),
          tags: ['auto-memory'],
          source_path: sourcePath,
          imported_hash: sourceHash,
          created: today,
          updated: today,
          status: 'active',
        });
        await mkdir(join(opts.vaultRoot, 'Memory'), { recursive: true });
        await writeFile(abs, frontmatter + content, 'utf8');
        continue;
      }

      const { fm, body } = splitNote(existing);
      const importedHash = fmField(fm, 'imported_hash');
      if (importedHash === sourceHash) {
        result.skipped.push(rel);
        continue;
      }
      if (importedHash !== null && sha1(body) === importedHash) {
        result.updated.push(rel);
        if (opts.dryRun) continue;
        const created = fmField(fm, 'created') ?? today;
        const frontmatter = buildFrontmatter({
          kind: 'memory',
          title: fmField(fm, 'title') ?? topicSlug,
          tags: ['auto-memory'],
          source_path: sourcePath,
          imported_hash: sourceHash,
          created,
          updated: today,
          status: fmField(fm, 'status') ?? 'active',
        });
        await writeFile(abs, frontmatter + content, 'utf8');
        continue;
      }
      result.conflicts.push(rel);
    }
  }

  return result;
}
