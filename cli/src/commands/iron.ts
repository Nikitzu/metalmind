import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { log } from '@clack/prompts';
import { readConfig } from '../config.js';
import { extractSymbols, type SymbolEntry } from '../forge/symbols.js';

export interface IronOptions {
  forge?: string;
  json?: boolean;
  exact?: boolean;
}

export function findRepoRoot(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function matchSymbols(symbols: SymbolEntry[], query: string, exact: boolean): SymbolEntry[] {
  const needle = query.trim();
  if (!needle) return [];
  const lower = needle.toLowerCase();
  const hits = symbols.filter((s) =>
    exact ? s.name === needle : s.name.toLowerCase().includes(lower),
  );
  return hits.sort((a, b) => {
    const aExact = a.name === needle ? 0 : 1;
    const bExact = b.name === needle ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.file.localeCompare(b.file);
  });
}

function formatHit(hit: SymbolEntry, repo: string): string {
  const rel = relative(repo, hit.file) || hit.file;
  return `  ${hit.kind.padEnd(9)} ${hit.name}  ${rel}:${hit.line}`;
}

async function repoTargets(opts: IronOptions): Promise<string[] | null> {
  if (!opts.forge) {
    const root = findRepoRoot();
    if (!root) {
      log.error('Not inside a git repository. Use `--forge <name>` to search a forge instead.');
      process.exitCode = 1;
      return null;
    }
    return [root];
  }
  const config = await readConfig();
  const group = config?.forge.groups[opts.forge];
  if (!group || group.repos.length === 0) {
    log.error(`forge '${opts.forge}' has no repos. Add some with \`metalmind forge add\`.`);
    process.exitCode = 1;
    return null;
  }
  return group.repos.filter((r) => existsSync(r));
}

export async function burnIron(symbol: string, opts: IronOptions = {}): Promise<void> {
  if (!symbol?.trim()) {
    log.error('Usage: metalmind burn iron <symbol>');
    process.exitCode = 1;
    return;
  }

  const repos = await repoTargets(opts);
  if (!repos) return;

  const byRepo: Array<{ repo: string; hits: SymbolEntry[] }> = [];
  for (const repo of repos) {
    const hits = matchSymbols(await extractSymbols(repo), symbol, opts.exact ?? false);
    if (hits.length > 0) byRepo.push({ repo, hits });
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ symbol, repos: byRepo }, null, 2)}\n`);
    return;
  }

  const total = byRepo.reduce((n, r) => n + r.hits.length, 0);
  if (total === 0) {
    log.info(`no declaration of '${symbol}' found in ${repos.length} repo(s)`);
    return;
  }

  for (const { repo, hits } of byRepo) {
    process.stdout.write(`\n=== ${repo} ===\n`);
    for (const hit of hits) process.stdout.write(`${formatHit(hit, repo)}\n`);
  }

  if (byRepo.length > 1) {
    const shared = new Set<string>();
    for (const { hits } of byRepo) for (const h of hits) shared.add(h.name);
    const crossRepo = [...shared].filter(
      (name) => byRepo.filter(({ hits }) => hits.some((h) => h.name === name)).length > 1,
    );
    if (crossRepo.length > 0) {
      process.stdout.write(`\ndeclared in more than one repo: ${crossRepo.join(', ')}\n`);
    }
  }

  process.stdout.write(
    `\n${total} declaration${total === 1 ? '' : 's'} across ${byRepo.length} repo${byRepo.length === 1 ? '' : 's'}.\n` +
      'Callers and call paths need a parser - install codegraph for those.\n',
  );
}
