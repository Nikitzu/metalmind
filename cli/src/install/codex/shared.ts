import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_CODEX_DIR = join(homedir(), '.codex');

export function recallCommand(flavor: 'scadrial' | 'classic'): string {
  return flavor === 'scadrial' ? 'metalmind tap copper' : 'metalmind recall';
}
