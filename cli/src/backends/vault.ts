import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  };
}
