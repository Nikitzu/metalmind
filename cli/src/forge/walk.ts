import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.mypy_cache',
  '.pytest_cache',
  'coverage',
  'target',
  'graphify-out',
  '.metalmind-stack',
  '.codegraph',
]);

export const JS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
export const PY_EXT = new Set(['.py']);
export const JAVA_EXT = new Set(['.java', '.kt']);

export async function* walk(root: string, exts: Set<string>): AsyncGenerator<string> {
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop();
    if (!dir) continue;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push(join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const dotIdx = entry.name.lastIndexOf('.');
        if (dotIdx < 0) continue;
        const ext = entry.name.slice(dotIdx);
        if (exts.has(ext)) yield join(dir, entry.name);
      }
    }
  }
}
