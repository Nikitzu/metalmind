// Pre-approved prefix rules (~/.codex/rules/metalmind.rules).
//
// Pre-approves the metalmind CLI surface so the first recall in a fresh
// Codex workspace doesn't hit an escalation prompt. metalmind owns the
// metalmind.rules file end-to-end (no sentinels needed; we write/delete
// the whole file). Codex auto-loads any *.rules file in ~/.codex/rules/
// per codex-rs/core/src/exec_policy.rs:988.
//
// CRITICAL: never touch ~/.codex/rules/default.rules — that's Codex's own
// user-acceptance log (it appends user-approved escalations there per
// codex-rs/core/src/exec_policy.rs:399).

import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTemplatesDir } from '../../util/paths.js';
import { DEFAULT_CODEX_DIR } from './shared.js';

export const METALMIND_RULES_FILENAME = 'metalmind.rules';

export interface CopyCodexPrefixRulesOptions {
  templatesDir?: string;
  codexDir?: string;
}

export interface CopyCodexPrefixRulesResult {
  rulesPath: string;
  action: 'created' | 'updated' | 'unchanged';
}

export async function copyCodexPrefixRules(
  opts: CopyCodexPrefixRulesOptions = {},
): Promise<CopyCodexPrefixRulesResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const rulesDir = join(codexDir, 'rules');
  await mkdir(rulesDir, { recursive: true });

  const rulesPath = join(rulesDir, METALMIND_RULES_FILENAME);
  const srcPath = join(templatesDir, 'codex', 'rules', METALMIND_RULES_FILENAME);
  const desired = await readFile(srcPath, 'utf8');

  let action: CopyCodexPrefixRulesResult['action'] = 'created';
  if (existsSync(rulesPath)) {
    const existing = await readFile(rulesPath, 'utf8');
    action = existing === desired ? 'unchanged' : 'updated';
  }
  if (action !== 'unchanged') {
    await writeFile(rulesPath, desired, 'utf8');
  }
  return { rulesPath, action };
}

/** Delete metalmind.rules. Never touches default.rules. */
export async function removeCodexPrefixRules(opts: { codexDir?: string } = {}): Promise<boolean> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const rulesPath = join(codexDir, 'rules', METALMIND_RULES_FILENAME);
  if (!existsSync(rulesPath)) return false;
  await unlink(rulesPath);
  return true;
}
