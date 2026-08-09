import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CLAUDE_DIR } from './templates.js';

export interface InstallShape {
  profile: 'core' | 'full';
  teams: boolean;
}

export function inferInstallShape(claudeDir: string = DEFAULT_CLAUDE_DIR): InstallShape {
  const full = existsSync(join(claudeDir, 'skills', 'synod'));
  let teams = false;
  try {
    teams = readdirSync(join(claudeDir, 'commands')).some(
      (f) => f.startsWith('team-') && f.endsWith('.md'),
    );
  } catch {
    teams = false;
  }
  return { profile: full ? 'full' : 'core', teams };
}

export interface ProfileFlags {
  core?: boolean;
  full?: boolean;
  teams?: boolean;
}

export function resolveProfile(
  flags: ProfileFlags,
  recorded: InstallShape | null,
): 'core' | 'full' | 'prompt' {
  if (flags.core === true) return 'core';
  if (flags.full === true) return 'full';
  if (recorded) return recorded.profile;
  return 'prompt';
}

export function resolveTeams(flags: ProfileFlags, recorded: InstallShape | null): boolean | 'prompt' {
  if (flags.teams !== undefined) return flags.teams;
  if (flags.core === true) return false;
  if (recorded) return recorded.teams;
  return 'prompt';
}
