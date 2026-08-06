import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';
import { clearGraphifyHooks } from './settings.js';

export const GRAPHIFY_PACKAGE = 'graphifyy';
export const GRAPHIFY_BIN = 'graphify';

const GRAPHIFY_STAMP_PREFIX = '## graphify';

export async function cleanLegacyHomeClaudeMdStamp(homeDir: string = homedir()): Promise<boolean> {
  const path = join(homeDir, 'CLAUDE.md');
  if (!existsSync(path)) return false;
  const current = await readFile(path, 'utf8');
  if (!current.includes(GRAPHIFY_STAMP_PREFIX)) return false;

  const start = current.indexOf(GRAPHIFY_STAMP_PREFIX);
  const afterStart = start + GRAPHIFY_STAMP_PREFIX.length;
  const nextHeadingMatch = current.slice(afterStart).match(/\n## /);
  const end =
    nextHeadingMatch && typeof nextHeadingMatch.index === 'number'
      ? afterStart + nextHeadingMatch.index + 1
      : current.length;
  const next = (current.slice(0, start) + current.slice(end)).replace(/\n{3,}/g, '\n\n').trimEnd();

  if (next.trim().length === 0) {
    await rm(path, { force: true });
  } else {
    await writeFile(path, `${next}\n`, 'utf8');
  }
  return true;
}

export async function isGraphifyInstalled(): Promise<boolean> {
  const res = await runCommand(GRAPHIFY_BIN, ['--version']);
  return res.ok;
}

export interface GraphifyResidueResult {
  wasInstalled: boolean;
  claudeUnwired: boolean;
  homeStampRemoved: boolean;
  uninstalled: boolean;
  removedAnything: boolean;
}

export async function removeGraphifyResidue(): Promise<GraphifyResidueResult> {
  const wasInstalled = await isGraphifyInstalled();
  let uninstalled = false;

  const claudeUnwired = await clearGraphifyHooks();

  if (wasInstalled) {
    const res = await runCommand('uv', ['tool', 'uninstall', GRAPHIFY_PACKAGE], {
      timeoutMs: 60_000,
    });
    uninstalled = res.ok;
  }

  const homeStampRemoved = await cleanLegacyHomeClaudeMdStamp();

  return {
    wasInstalled,
    claudeUnwired,
    homeStampRemoved,
    uninstalled,
    removedAnything: claudeUnwired || homeStampRemoved || uninstalled,
  };
}
