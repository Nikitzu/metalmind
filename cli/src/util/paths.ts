import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function expandTilde(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

export function getTemplatesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'templates'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Could not locate metalmind templates directory');
    }
    dir = parent;
  }
  return join(dir, 'templates');
}
