import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getTemplatesDir } from '../util/paths.js';
import {
  removeSentinelBlock,
  type SentinelMarkers,
  type SentinelUpsertAction,
  upsertSentinelBlock,
} from '../util/sentinel.js';

export const DEFAULT_CODEX_DIR = join(homedir(), '.codex');

const CODEX_AGENTS_MARKERS: SentinelMarkers = {
  begin: '<!-- metalmind:codex:agents:begin -->',
  end: '<!-- metalmind:codex:agents:end -->',
};

export function recallCommand(flavor: 'scadrial' | 'classic'): string {
  return flavor === 'scadrial' ? 'metalmind tap copper' : 'metalmind recall';
}

export interface StampCodexAgentsMdOptions {
  vaultPath: string;
  flavor: 'scadrial' | 'classic';
  templatesDir?: string;
  codexDir?: string;
}

export interface StampCodexAgentsMdResult {
  path: string;
  blockAction: SentinelUpsertAction;
}

export async function stampCodexAgentsMd(
  opts: StampCodexAgentsMdOptions,
): Promise<StampCodexAgentsMdResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const target = join(codexDir, 'AGENTS.md');

  await mkdir(codexDir, { recursive: true });

  const blockSource = await readFile(
    join(templatesDir, 'codex', 'AGENTS.md.block.template'),
    'utf8',
  );
  const rendered = blockSource
    .replace(/\{\{VAULT_PATH\}\}/g, opts.vaultPath)
    .replace(/\{\{RECALL_CMD\}\}/g, recallCommand(opts.flavor));

  const { action } = await upsertSentinelBlock({
    path: target,
    content: rendered,
    markers: CODEX_AGENTS_MARKERS,
  });

  return { path: target, blockAction: action };
}

export async function clearCodexAgentsMd(opts: { codexDir?: string } = {}): Promise<boolean> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const target = join(codexDir, 'AGENTS.md');
  if (!existsSync(target)) return false;
  const result = await removeSentinelBlock({
    path: target,
    markers: CODEX_AGENTS_MARKERS,
    deleteIfEmpty: true,
  });
  return result.action === 'removed' || result.action === 'file-empty';
}
