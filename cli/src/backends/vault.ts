import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const VAULT_INBOX_SUBDIR = 'Inbox';

export interface SaveToVaultOptions {
  vaultPath: string;
  content: string;
  title?: string;
  tags?: string[];
  project?: string;
  now?: Date;
}

export interface SaveToVaultResult {
  path: string;
  filename: string;
  bytesWritten: number;
  /** True when an existing Inbox note with identical body content was found;
   *  we return its path instead of creating a duplicate. */
  deduped: boolean;
}

function normalizeForHash(content: string): string {
  return content.trim();
}

function contentHash(content: string): string {
  return createHash('sha1').update(normalizeForHash(content)).digest('hex');
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---\n')) return raw;
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) return raw;
  return raw.slice(end + 5);
}

function stripLeadingHeading(body: string): string {
  return body.replace(/^#\s+.*\n/, '');
}

async function findExistingByHash(inbox: string, hash: string): Promise<string | null> {
  if (!existsSync(inbox)) return null;
  const entries = await readdir(inbox, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const existing = await readFile(join(inbox, entry.name), 'utf8');
    const body = stripLeadingHeading(stripFrontmatter(existing)).trim();
    if (contentHash(body) === hash) {
      return join(inbox, entry.name);
    }
  }
  return null;
}

function slugify(input: string): string {
  const trimmed = input.trim().slice(0, 60);
  return (
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'note'
  );
}

function formatTimestamp(d: Date): { dateOnly: string; filenameSlug: string } {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateOnly = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const filenameSlug = `${dateOnly}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return { dateOnly, filenameSlug };
}

function inferTitle(content: string): string {
  const firstLine = content.trim().split('\n')[0]?.trim() ?? '';
  const withoutHeading = firstLine.replace(/^#+\s*/, '');
  return withoutHeading || 'note';
}

function buildFrontmatter(opts: {
  title: string;
  tags: string[];
  created: string;
  project?: string;
}): string {
  const lines = ['---', `title: ${opts.title}`];
  lines.push(`tags: [${opts.tags.map((t) => JSON.stringify(t)).join(', ')}]`);
  lines.push(`created: ${opts.created}`);
  lines.push(`updated: ${opts.created}`);
  if (opts.project) lines.push(`project: ${opts.project}`);
  lines.push('status: draft');
  lines.push('---');
  return lines.join('\n');
}

export async function saveToVault(opts: SaveToVaultOptions): Promise<SaveToVaultResult> {
  const now = opts.now ?? new Date();
  const title = opts.title?.trim() || inferTitle(opts.content);
  const { dateOnly, filenameSlug } = formatTimestamp(now);
  const slug = slugify(title);
  const filename = `${filenameSlug}-${slug}.md`;

  const inbox = join(opts.vaultPath, VAULT_INBOX_SUBDIR);
  if (!existsSync(inbox)) {
    await mkdir(inbox, { recursive: true });
  }

  const hash = contentHash(opts.content);
  const existing = await findExistingByHash(inbox, hash);
  if (existing) {
    return {
      path: existing,
      filename: basename(existing),
      bytesWritten: 0,
      deduped: true,
    };
  }

  const destPath = join(inbox, filename);
  const frontmatter = buildFrontmatter({
    title,
    tags: opts.tags ?? ['inbox'],
    created: dateOnly,
    project: opts.project,
  });
  const body = `${frontmatter}\n\n# ${title}\n\n${opts.content.trim()}\n`;
  await writeFile(destPath, body, 'utf8');

  return {
    path: destPath,
    filename,
    bytesWritten: Buffer.byteLength(body, 'utf8'),
    deduped: false,
  };
}
