import { homedir } from 'node:os';
import { join } from 'node:path';

// Antigravity reads global rules from ~/.gemini/AGENTS.md (and GEMINI.md) and
// discovers global customizations under ~/.gemini/config/.
export const DEFAULT_GEMINI_DIR = join(homedir(), '.gemini');

export function recallCommand(flavor: 'scadrial' | 'classic'): string {
  return flavor === 'scadrial' ? 'metalmind tap copper' : 'metalmind recall';
}
