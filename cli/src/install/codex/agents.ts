// AGENTS.md stamping for Codex.
//
// Sentinel-bounded block in ~/.codex/AGENTS.md (HTML-comment markers since
// AGENTS.md is markdown). Codex injects this block wrapped in
// <INSTRUCTIONS> on every turn - verified via `codex debug prompt-input`.

import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTemplatesDir } from '../../util/paths.js';
import {
  removeSentinelBlock,
  type SentinelMarkers,
  type SentinelUpsertAction,
  upsertSentinelBlock,
} from '../../util/sentinel.js';
import { resolvePartials } from '../templates.js';
import { DEFAULT_CODEX_DIR, recallCommand } from './shared.js';

const CODEX_AGENTS_MARKERS: SentinelMarkers = {
  begin: '<!-- metalmind:codex:agents:begin -->',
  end: '<!-- metalmind:codex:agents:end -->',
};

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
  const resolvedBlock = await resolvePartials(blockSource, templatesDir);
  const rendered = resolvedBlock
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
