import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cleanLegacyHomeClaudeMdStamp } from './graphify-legacy.js';
import { clearGraphifyHooks } from './settings.js';

export const REPAIR_STATE_DIR = join(homedir(), '.metalmind', 'repairs');

export interface RepairResult {
  name: string;
  applied: boolean;
  detail?: string;
}

export interface Repair {
  name: string;
  run: () => Promise<string | null>;
}

export const REPAIRS: Repair[] = [
  {
    name: 'graphify-claude-hook',
    run: async () => {
      const cleared = await clearGraphifyHooks();
      const stamp = await cleanLegacyHomeClaudeMdStamp();
      const parts: string[] = [];
      if (cleared) parts.push('removed the graphify hook from ~/.claude/settings.json');
      if (stamp) parts.push('cleaned the graphify stamp from ~/CLAUDE.md');
      return parts.length > 0 ? parts.join('; ') : null;
    },
  },
];

export async function runPendingRepairs(
  opts: { stateDir?: string; repairs?: Repair[] } = {},
): Promise<RepairResult[]> {
  const stateDir = opts.stateDir ?? REPAIR_STATE_DIR;
  const list = opts.repairs ?? REPAIRS;
  const out: RepairResult[] = [];

  for (const repair of list) {
    const marker = join(stateDir, repair.name);
    if (existsSync(marker)) continue;
    let detail: string | null = null;
    try {
      detail = await repair.run();
    } catch {
      continue;
    }
    try {
      await mkdir(stateDir, { recursive: true });
      await writeFile(marker, new Date().toISOString(), 'utf8');
    } catch {
      continue;
    }
    out.push({ name: repair.name, applied: detail !== null, detail: detail ?? undefined });
  }

  return out;
}
