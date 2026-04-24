import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { log } from '@clack/prompts';
import { shelfDir } from '../forge/openapi.js';
import {
  addRepoToForge,
  createForge,
  deleteForge,
  listForges,
  removeRepoFromForge,
} from '../forge/store.js';

function fail(message: string): void {
  log.error(message);
  process.exitCode = 1;
}

export async function forgeCreate(name: string): Promise<void> {
  try {
    await createForge(name);
    log.success(`forge '${name}' created`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function forgeAdd(name: string, repoPath: string): Promise<void> {
  try {
    await addRepoToForge(name, repoPath);
    log.success(`added ${repoPath} to forge '${name}'`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function forgeRemove(name: string, repoPath: string): Promise<void> {
  try {
    await removeRepoFromForge(name, repoPath);
    log.success(`removed ${repoPath} from forge '${name}'`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function forgeDelete(name: string): Promise<void> {
  try {
    await deleteForge(name);
    log.success(`forge '${name}' deleted`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function detectExt(source: string, contentType: string | null, body: string): 'json' | 'yaml' {
  if (source.endsWith('.json')) return 'json';
  if (source.endsWith('.yaml') || source.endsWith('.yml')) return 'yaml';
  if (contentType?.includes('json')) return 'json';
  if (contentType?.includes('yaml')) return 'yaml';
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  return 'yaml';
}

async function readSource(source: string): Promise<{ body: string; ext: 'json' | 'yaml' }> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`fetch ${source} — HTTP ${res.status}`);
    const body = await res.text();
    return { body, ext: detectExt(source, res.headers.get('content-type'), body) };
  }
  const body = await readFile(source, 'utf8');
  return { body, ext: detectExt(source, null, body) };
}

export async function forgeCaptureSpec(
  repoPath: string,
  source: string,
  opts: { as?: string } = {},
): Promise<void> {
  try {
    const slug = opts.as ?? basename(repoPath.replace(/\/+$/, ''));
    if (!slug) throw new Error('could not derive shelf slug from repo path');
    const { body, ext } = await readSource(source);
    await mkdir(shelfDir(), { recursive: true });
    for (const other of ['yaml', 'yml', 'json'] as const) {
      if (other === ext) continue;
      const dup = join(shelfDir(), `${slug}.${other}`);
      try {
        await stat(dup);
        await unlink(dup);
      } catch {
        // not there — nothing to remove
      }
    }
    const dest = join(shelfDir(), `${slug}.${ext}`);
    await writeFile(dest, body, 'utf8');
    log.success(`captured OpenAPI spec → ${dest}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function forgeSpecList(): Promise<void> {
  try {
    const dir = shelfDir();
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      log.info('No specs on the shelf yet. Use `metalmind forge capture-spec <repo> <url>`.');
      return;
    }
    const specs = entries.filter((f) => /\.(ya?ml|json)$/i.test(f));
    if (specs.length === 0) {
      log.info('No specs on the shelf yet. Use `metalmind forge capture-spec <repo> <url>`.');
      return;
    }
    log.info(`spec shelf: ${dir}`);
    for (const f of specs.sort()) log.info(`  - ${f}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function forgeSpecRemove(slug: string): Promise<void> {
  try {
    const s = basename(slug);
    let removed = 0;
    for (const ext of ['yaml', 'yml', 'json'] as const) {
      const abs = join(shelfDir(), `${s}.${ext}`);
      try {
        await unlink(abs);
        removed++;
      } catch {
        // missing is fine
      }
    }
    if (removed === 0) {
      fail(`no shelf spec for '${s}'`);
      return;
    }
    log.success(`removed ${removed} shelf file(s) for '${s}'`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function forgeList(): Promise<void> {
  try {
    const groups = await listForges();
    const names = Object.keys(groups);
    if (names.length === 0) {
      log.info('No forges defined. Create one with `metalmind forge create <name>`.');
      return;
    }
    for (const name of names) {
      const repos = groups[name]?.repos ?? [];
      log.info(`${name} (${repos.length} repo${repos.length === 1 ? '' : 's'})`);
      for (const r of repos) log.info(`  - ${r}`);
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
