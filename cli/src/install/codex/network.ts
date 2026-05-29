// Sandbox network access ([sandbox_workspace_write] network_access = true).
//
// Codex's default workspace-write sandbox blocks loopback network. Without
// network_access=true, every `metalmind tap copper` call (loopback HTTP to
// 127.0.0.1:17317) fails with a network-proxy denial. We stamp this in a
// sentinel-bounded TOML block; sentinels use # line comments so TOML parses
// the file cleanly.
//
// Caveat: TOML semantics mean if the user has a competing
// [sandbox_workspace_write] table OUTSIDE our sentinels with
// network_access=false, the user's value wins and recall breaks. Documented
// in cookbook-codex.md.

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
import { DEFAULT_CODEX_DIR } from './shared.js';

const CODEX_NETWORK_MARKERS: SentinelMarkers = {
  begin: '# metalmind:codex:network:begin',
  end: '# metalmind:codex:network:end',
};

export interface ApplyCodexNetworkAccessOptions {
  templatesDir?: string;
  codexDir?: string;
}

export interface ApplyCodexNetworkAccessResult {
  configTomlPath: string;
  blockAction: SentinelUpsertAction;
}

export async function applyCodexNetworkAccess(
  opts: ApplyCodexNetworkAccessOptions = {},
): Promise<ApplyCodexNetworkAccessResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const target = join(codexDir, 'config.toml');

  await mkdir(codexDir, { recursive: true });

  const blockSource = await readFile(
    join(templatesDir, 'codex', 'config.toml.network.template'),
    'utf8',
  );

  const { action } = await upsertSentinelBlock({
    path: target,
    content: blockSource,
    markers: CODEX_NETWORK_MARKERS,
  });

  return { configTomlPath: target, blockAction: action };
}

export async function clearCodexNetworkAccess(opts: { codexDir?: string } = {}): Promise<boolean> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const target = join(codexDir, 'config.toml');
  if (!existsSync(target)) return false;
  const result = await removeSentinelBlock({
    path: target,
    markers: CODEX_NETWORK_MARKERS,
    deleteIfEmpty: true,
  });
  return result.action === 'removed' || result.action === 'file-empty';
}
