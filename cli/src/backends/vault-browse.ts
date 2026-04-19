import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface RecentNote {
  path: string;
  relPath: string;
  modifiedMs: number;
  title: string;
  excerpt: string;
}

const SKIP_DIRS = new Set(['.obsidian', '.metalmind-stack', '.trash', 'node_modules']);

async function* walkMarkdown(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdown(p);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield p;
    }
  }
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) return content;
  return content.slice(end + 5);
}

function extractTitle(body: string, fallbackPath: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  if (match?.[1]) return match[1].trim();
  const name = fallbackPath.split('/').pop() ?? fallbackPath;
  return name.replace(/\.md$/, '');
}

function extractExcerpt(body: string, maxChars = 180): string {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const joined = lines.slice(0, 2).join(' ');
  return joined.length > maxChars ? `${joined.slice(0, maxChars - 1)}…` : joined;
}

export async function listRecentNotes(vaultPath: string, n: number): Promise<RecentNote[]> {
  const items: Array<{ path: string; mtime: number }> = [];
  for await (const path of walkMarkdown(vaultPath)) {
    const s = await stat(path);
    items.push({ path, mtime: s.mtimeMs });
  }
  items.sort((a, b) => b.mtime - a.mtime);
  const top = items.slice(0, Math.max(1, n));
  return Promise.all(
    top.map(async ({ path, mtime }) => {
      const content = await readFile(path, 'utf8');
      const body = stripFrontmatter(content).trim();
      return {
        path,
        relPath: relative(vaultPath, path),
        modifiedMs: mtime,
        title: extractTitle(body, path),
        excerpt: extractExcerpt(body),
      };
    }),
  );
}
