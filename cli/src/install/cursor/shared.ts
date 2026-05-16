import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_CURSOR_DIR = join(homedir(), '.cursor');

export function recallCommand(flavor: 'scadrial' | 'classic'): string {
  return flavor === 'scadrial' ? 'metalmind tap copper' : 'metalmind recall';
}
