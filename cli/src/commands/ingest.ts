import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { frontmatterString, parseFrontmatter, splitFrontmatter } from '../scribe/frontmatter.js';
import { buildFrontmatter, rewriteFrontmatterField, slugify } from '../scribe/scribe.js';

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

export async function ingestAutoMemoryCmd(opts: { dryRun?: boolean }): Promise<void> {
  const { log } = await import('@clack/prompts');
  const { readConfig } = await import('../config.js');
  const config = await readConfig();
  if (!config) {
    log.error('No ~/.metalmind/config.json - run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }
  const res = await ingestAutoMemory({ vaultRoot: config.vaultPath, dryRun: opts.dryRun });
  const verb = opts.dryRun ? 'would import' : 'imported';
  log.info(
    `${verb}: ${res.created.length} created, ${res.updated.length} updated, ` +
      `${res.skipped.length} skipped, ${res.conflicts.length} conflicts`,
  );
  for (const c of res.created) log.success(`  + ${c}`);
  for (const u of res.updated) log.success(`  ~ ${u}`);
  for (const x of res.conflicts)
    log.warn(`  ! ${x} - locally edited and source changed; resolve by hand`);
  if (res.created.length + res.updated.length + res.skipped.length + res.conflicts.length === 0) {
    log.info('  no auto-memory files found under ~/.claude/projects/*/memory/');
  }
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

      const { body } = splitFrontmatter(existing);
      const importedHash = frontmatterString(parseFrontmatter(existing).fm, 'imported_hash');
      if (importedHash === sourceHash) {
        result.skipped.push(rel);
        continue;
      }
      if (importedHash !== null && sha1(body) === importedHash) {
        result.updated.push(rel);
        if (opts.dryRun) continue;
        let head = existing.slice(0, existing.length - body.length);
        head = rewriteFrontmatterField(head, 'imported_hash', sourceHash);
        head = rewriteFrontmatterField(head, 'source_path', sourcePath);
        head = rewriteFrontmatterField(head, 'updated', today);
        await writeFile(abs, head + content, 'utf8');
        continue;
      }
      result.conflicts.push(rel);
    }
  }

  return result;
}
