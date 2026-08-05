import { existsSync } from 'node:fs';
import { basename } from 'node:path';
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
  const fm = /^---\n([\s\S]*?)\n---/.exec(head);
  if (!fm?.[1]) return [];
  const line = /^code:[ \t]*\[(.*)\]$/m.exec(fm[1]);
  if (!line?.[1]) return [];
  try {
    const parsed = JSON.parse(`[${line[1]}]`) as unknown[];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return line[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
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

function definitionPatterns(symbol: string): [string, string] {
  const kw = '(function|class|const|let|var|def|fn|interface|type|struct|enum|trait|impl|val|fun)';
  return [`${kw}\\s+${symbol}\\b`, `\\b${symbol}\\s*[=(:]`];
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
}

export async function checkSymbol(
  repoPath: string,
  symbol: string,
  opts: CheckSymbolOptions = {},
): Promise<{ status: CodeRefStatus; detail?: string }> {
  const timeoutMs = opts.timeoutMs ?? PER_REPO_TIMEOUT_MS;
  const tool =
    opts.tool === undefined || opts.tool === 'auto' ? ((await hasRg()) ? 'rg' : 'grep') : opts.tool;
  const [defPattern, fallbackPattern] = definitionPatterns(symbol);

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
            defPattern,
            '-e',
            fallbackPattern,
            repoPath,
          ],
          { timeoutMs },
        )
      : await runCommand(
          'grep',
          [
            '-r',
            '-l',
            '-E',
            `${defPattern}|${fallbackPattern}`,
            ...SKIP_DIRS.map((d) => `--exclude-dir=${d}`),
            repoPath,
          ],
          { timeoutMs },
        );

  if (res.ok && res.stdout.trim()) return { status: 'ok' };
  if (res.exitCode === 1) return { status: 'missing' };
  if (res.exitCode === null) {
    return {
      status: 'unresolvable-repo',
      detail: `search failed or timed out (${timeoutMs}ms cap)`,
    };
  }
  return { status: 'unresolvable-repo', detail: res.stderr.slice(0, 120) || 'search failed' };
}

export async function collectVaultCodeRefs(vaultPath: string): Promise<Map<string, string[]>> {
  const { readdir, readFile } = await import('node:fs/promises');
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
      if (!item.name.endsWith('.md')) continue;
      let head: string;
      try {
        head = (await readFile(full, 'utf8')).slice(0, 2048);
      } catch {
        continue;
      }
      const refs = parseCodeRefsFromHead(head);
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
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
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
