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
import { DEFAULT_GEMINI_DIR, recallCommand } from './shared.js';

const MARKERS: SentinelMarkers = {
  begin: '<!-- metalmind:antigravity:agents:begin -->',
  end: '<!-- metalmind:antigravity:agents:end -->',
};

export interface StampAntigravityAgentsMdOptions {
  vaultPath: string;
  flavor: 'scadrial' | 'classic';
  templatesDir?: string;
  geminiDir?: string;
}

export async function stampAntigravityAgentsMd(
  opts: StampAntigravityAgentsMdOptions,
): Promise<{ path: string; blockAction: SentinelUpsertAction }> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const geminiDir = opts.geminiDir ?? DEFAULT_GEMINI_DIR;
  const target = join(geminiDir, 'AGENTS.md');
  await mkdir(geminiDir, { recursive: true });
  // The Codex block is host-agnostic prose about recall and scribe; the only
  // Codex-specific part is where it is read from, which is this file's path.
  const blockSource = await readFile(
    join(templatesDir, 'codex', 'AGENTS.md.block.template'),
    'utf8',
  );
  const rendered = (await resolvePartials(blockSource, templatesDir))
    .replace(/\{\{VAULT_PATH\}\}/g, opts.vaultPath)
    .replace(/\{\{RECALL_CMD\}\}/g, recallCommand(opts.flavor));
  const { action } = await upsertSentinelBlock({
    path: target,
    content: rendered,
    markers: MARKERS,
  });
  return { path: target, blockAction: action };
}

export async function clearAntigravityAgentsMd(
  opts: { geminiDir?: string } = {},
): Promise<boolean> {
  const target = join(opts.geminiDir ?? DEFAULT_GEMINI_DIR, 'AGENTS.md');
  if (!existsSync(target)) return false;
  const result = await removeSentinelBlock({ path: target, markers: MARKERS, deleteIfEmpty: true });
  return result.action === 'removed' || result.action === 'file-empty';
}
