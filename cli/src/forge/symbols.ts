import { readFile } from 'node:fs/promises';
import { JAVA_EXT, JS_EXT, PY_EXT, walk } from './walk.js';

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'record';

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  repo: string;
}

const MIN_NAME_LENGTH = 4;

const GENERIC_NAMES = new Set([
  'main',
  'index',
  'setup',
  'config',
  'options',
  'result',
  'error',
  'handler',
  'handlers',
  'router',
  'routes',
  'server',
  'client',
  'utils',
  'util',
  'helper',
  'helpers',
  'types',
  'schema',
  'model',
  'models',
  'test',
  'tests',
  'data',
  'value',
  'props',
  'state',
  'context',
  'provider',
  'default',
  'response',
  'request',
  'params',
  'args',
  'input',
  'output',
  'item',
  'items',
  'list',
  'name',
  'base',
  'core',
]);

const JS_DECL_RE =
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;

const JS_KIND: Record<string, SymbolKind> = {
  function: 'function',
  'function*': 'function',
  class: 'class',
  interface: 'interface',
  type: 'type',
  enum: 'enum',
  const: 'const',
  let: 'const',
  var: 'const',
};

const PY_DECL_RE = /^(def|class)\s+([A-Za-z_]\w*)/;

const JAVA_DECL_RE =
  /^\s*(?:public\s+|internal\s+)?(?:final\s+|abstract\s+|sealed\s+|open\s+|data\s+|static\s+)*(class|interface|enum|record|object|fun)\s+([A-Za-z_]\w*)/;

const JAVA_KIND: Record<string, SymbolKind> = {
  class: 'class',
  interface: 'interface',
  enum: 'enum',
  record: 'record',
  object: 'class',
  fun: 'function',
};

export function isInterestingName(name: string): boolean {
  if (name.length < MIN_NAME_LENGTH) return false;
  if (name.startsWith('_')) return false;
  if (GENERIC_NAMES.has(name.toLowerCase())) return false;
  return true;
}

function parseWith(
  content: string,
  re: RegExp,
  kinds: Record<string, SymbolKind>,
  file: string,
  repo: string,
): SymbolEntry[] {
  const out: SymbolEntry[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = re.exec(lines[i] ?? '');
    if (!match) continue;
    const name = match[2];
    if (!name || !isInterestingName(name)) continue;
    const kind = kinds[match[1] ?? ''];
    if (!kind) continue;
    out.push({ name, kind, file, line: i + 1, repo });
  }
  return out;
}

export function parseJsSymbols(content: string, file: string, repo: string): SymbolEntry[] {
  return parseWith(content, JS_DECL_RE, JS_KIND, file, repo);
}

export function parsePySymbols(content: string, file: string, repo: string): SymbolEntry[] {
  return parseWith(content, PY_DECL_RE, { def: 'function', class: 'class' }, file, repo);
}

export function parseJavaSymbols(content: string, file: string, repo: string): SymbolEntry[] {
  return parseWith(content, JAVA_DECL_RE, JAVA_KIND, file, repo);
}

export async function extractSymbols(repo: string): Promise<SymbolEntry[]> {
  const out: SymbolEntry[] = [];
  for await (const file of walk(repo, JS_EXT)) {
    out.push(...parseJsSymbols(await readFile(file, 'utf8'), file, repo));
  }
  for await (const file of walk(repo, PY_EXT)) {
    out.push(...parsePySymbols(await readFile(file, 'utf8'), file, repo));
  }
  for await (const file of walk(repo, JAVA_EXT)) {
    out.push(...parseJavaSymbols(await readFile(file, 'utf8'), file, repo));
  }
  return out;
}
