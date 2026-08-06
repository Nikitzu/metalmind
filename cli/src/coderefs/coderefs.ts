import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { frontmatterList, parseFrontmatter, readNoteFrontmatter } from '../scribe/frontmatter.js';
import { runCommand } from '../util/exec.js';

export type CodeRefStatus = 'ok' | 'missing' | 'unresolvable-repo';

export interface CodeRef {
  repo: string;
  symbol: string;
  raw: string;
}

export interface CodeRefResult {
  ref: string;
  status: CodeRefStatus;
  detail?: string;
}

export interface ForgeGroups {
  [name: string]: { repos: string[] };
}

const REF_RE = /^([A-Za-z0-9._-]+)#([A-Za-z_$][A-Za-z0-9_$]*)$/;

export function parseCodeRef(raw: string): CodeRef | null {
  const m = REF_RE.exec(raw.trim());
  if (!m?.[1] || !m[2]) return null;
  return { repo: m[1], symbol: m[2], raw: raw.trim() };
}

export function parseCodeRefsFromHead(head: string): string[] {
  return frontmatterList(parseFrontmatter(head).fm, 'code');
}

export function resolveRepoPath(repo: string, groups: ForgeGroups): string | null {
  for (const name of Object.keys(groups).sort()) {
    for (const path of groups[name]?.repos ?? []) {
      if (basename(path) === repo && existsSync(path)) return path;
    }
  }
  return null;
}

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', 'target', '.venv'];
const PER_REPO_TIMEOUT_MS = 2000;
const TOTAL_TIMEOUT_MS = 10_000;

const DEFINITION_KEYWORDS = [
  'function',
  'func',
  'class',
  'const',
  'let',
  'var',
  'def',
  'fn',
  'fun',
  'interface',
  'type',
  'struct',
  'enum',
  'trait',
  'impl',
  'record',
  'object',
  'module',
  'val',
].join('|');

function escapeSymbol(rawSymbol: string): string {
  return rawSymbol.replace(/[$^.*+?()[\]{}|\\]/g, '\\$&');
}

function definitionPattern(rawSymbol: string): string {
  return `(${DEFINITION_KEYWORDS})\\s+${escapeSymbol(rawSymbol)}\\b`;
}

function referencePattern(rawSymbol: string): string {
  return `\\b${escapeSymbol(rawSymbol)}\\s*[=(:]`;
}

let rgAvailable: boolean | null = null;

async function hasRg(): Promise<boolean> {
  if (rgAvailable === null) {
    rgAvailable = (await runCommand('rg', ['--version'])).ok;
  }
  return rgAvailable;
}

export interface CheckSymbolOptions {
  tool?: 'rg' | 'grep' | 'auto';
  timeoutMs?: number;
  deadline?: number;
}

export async function checkSymbol(
  repoPath: string,
  symbol: string,
  opts: CheckSymbolOptions = {},
): Promise<{ status: CodeRefStatus; detail?: string }> {
  const timeoutMs = opts.timeoutMs ?? PER_REPO_TIMEOUT_MS;
  const tool =
    opts.tool === undefined || opts.tool === 'auto' ? ((await hasRg()) ? 'rg' : 'grep') : opts.tool;

  const search = async (pattern: string): Promise<{ found: boolean; fatal?: string }> => {
    const res =
      tool === 'rg'
        ? await runCommand(
            'rg',
            [
              '-l',
              '--max-count',
              '1',
              ...SKIP_DIRS.flatMap((d) => ['-g', `!${d}`]),
              '-e',
              pattern,
              repoPath,
            ],
            { timeoutMs },
          )
        : await runCommand(
            'grep',
            ['-r', '-l', '-E', pattern, ...SKIP_DIRS.map((d) => `--exclude-dir=${d}`), repoPath],
            { timeoutMs },
          );
    if (res.ok && res.stdout.trim()) return { found: true };
    if (res.exitCode === 1) return { found: false };
    if (res.exitCode === null) {
      return { found: false, fatal: `search failed or timed out (${timeoutMs}ms cap)` };
    }
    return { found: false, fatal: res.stderr.slice(0, 120) || 'search failed' };
  };

  const def = await search(definitionPattern(symbol));
  if (def.fatal) return { status: 'unresolvable-repo', detail: def.fatal };
  if (def.found) return { status: 'ok' };

  const ref = await search(referencePattern(symbol));
  if (ref.fatal) return { status: 'unresolvable-repo', detail: ref.fatal };
  if (ref.found) {
    return { status: 'ok', detail: 'matched a reference, not a definition' };
  }
  return { status: 'missing' };
}

export async function collectVaultCodeRefs(vaultPath: string): Promise<Map<string, string[]>> {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const out = new Map<string, string[]>();
  const skip = new Set(['.obsidian', '.metalmind-stack', '.trash', '.git']);
  const walk = async (dir: string): Promise<void> => {
    let items: import('node:fs').Dirent[];
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        if (!skip.has(item.name)) await walk(full);
        continue;
      }
      if (item.isSymbolicLink()) continue;
      if (!item.name.endsWith('.md')) continue;
      const refs = frontmatterList(await readNoteFrontmatter(full), 'code');
      if (refs.length > 0) out.set(item.name.replace(/\.md$/, ''), refs);
    }
  };
  await walk(vaultPath);
  return out;
}

export async function verifyCodeRefs(
  refs: string[],
  groups: ForgeGroups,
  opts: CheckSymbolOptions = {},
): Promise<CodeRefResult[]> {
  const deadline = opts.deadline ?? Date.now() + TOTAL_TIMEOUT_MS;
  const results: CodeRefResult[] = [];
  for (const raw of refs) {
    const parsed = parseCodeRef(raw);
    if (!parsed) {
      results.push({ ref: raw, status: 'unresolvable-repo', detail: 'malformed ref' });
      continue;
    }
    const repoPath = resolveRepoPath(parsed.repo, groups);
    if (!repoPath) {
      results.push({
        ref: raw,
        status: 'unresolvable-repo',
        detail: `repo '${parsed.repo}' not registered in any forge`,
      });
      continue;
    }
    if (Date.now() > deadline) {
      results.push({
        ref: raw,
        status: 'unresolvable-repo',
        detail: 'verification budget exhausted',
      });
      continue;
    }
    const check = await checkSymbol(repoPath, parsed.symbol, opts);
    results.push({ ref: raw, ...check });
  }
  return results;
}
