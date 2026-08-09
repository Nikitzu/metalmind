import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inferInstallShape, resolveProfile, resolveTeams } from './profile.js';

describe('inferInstallShape', () => {
  let claudeDir: string;

  beforeEach(async () => {
    claudeDir = await mkdtemp(join(tmpdir(), 'mm-profile-'));
  });
  afterEach(async () => {
    await rm(claudeDir, { recursive: true, force: true });
  });

  it('reads synod as full and team-* commands as teams', async () => {
    await mkdir(join(claudeDir, 'skills', 'synod'), { recursive: true });
    await mkdir(join(claudeDir, 'commands'), { recursive: true });
    await writeFile(join(claudeDir, 'commands', 'team-debug.md'), 'x');

    expect(inferInstallShape(claudeDir)).toEqual({ profile: 'full', teams: true });
  });

  it('reads a core-shaped dir as core without teams', async () => {
    await mkdir(join(claudeDir, 'skills', 'metalmind-cli'), { recursive: true });
    await mkdir(join(claudeDir, 'commands'), { recursive: true });
    await writeFile(join(claudeDir, 'commands', 'save.md'), 'x');

    expect(inferInstallShape(claudeDir)).toEqual({ profile: 'core', teams: false });
  });

  it('ignores a hand-rolled agents dir - users own that space', async () => {
    await mkdir(join(claudeDir, 'agents'), { recursive: true });
    await writeFile(join(claudeDir, 'agents', 'my-own-agent.md'), 'x');

    expect(inferInstallShape(claudeDir)).toEqual({ profile: 'core', teams: false });
  });

  it('handles a missing dir entirely', async () => {
    expect(inferInstallShape(join(claudeDir, 'nope'))).toEqual({
      profile: 'core',
      teams: false,
    });
  });
});

describe('resolveProfile / resolveTeams', () => {
  const fullTeams = { profile: 'full', teams: true } as const;

  it('explicit flags beat the recorded manifest', () => {
    expect(resolveProfile({ core: true }, fullTeams)).toBe('core');
    expect(resolveProfile({ full: true }, { profile: 'core', teams: false })).toBe('full');
    expect(resolveTeams({ teams: false }, fullTeams)).toBe(false);
  });

  it('recorded manifest beats the prompt', () => {
    expect(resolveProfile({}, fullTeams)).toBe('full');
    expect(resolveTeams({}, fullTeams)).toBe(true);
  });

  it('fresh machine with no flags prompts', () => {
    expect(resolveProfile({}, null)).toBe('prompt');
    expect(resolveTeams({}, null)).toBe('prompt');
  });

  it('an explicit --core narrows recorded teams, but an explicit --teams survives --core', () => {
    expect(resolveTeams({ core: true }, fullTeams)).toBe(false);
    expect(resolveTeams({ core: true, teams: true }, fullTeams)).toBe(true);
  });
});
