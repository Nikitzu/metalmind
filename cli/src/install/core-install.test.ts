import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyClaudeTemplates } from './templates.js';

async function ls(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

describe('core install', () => {
  let claudeDir: string;

  beforeEach(async () => {
    claudeDir = await mkdtemp(join(tmpdir(), 'mm-core-'));
  });
  afterEach(async () => {
    await rm(claudeDir, { recursive: true, force: true });
  });

  it('keeps the memory surface: rules, the save commands, and the recall skills', async () => {
    await copyClaudeTemplates({ claudeDir, core: true });

    expect(await ls(join(claudeDir, 'rules'))).toContain('principles.md');
    const commands = await ls(join(claudeDir, 'commands'));
    expect(commands).toContain('save.md');
    expect(commands).toContain('sync.md');
    const skills = await ls(join(claudeDir, 'skills'));
    expect(skills).toContain('metalmind-cli');
    expect(skills).toContain('writing-vault-notes');
  });

  it('skips the workflow layer: subagents, team commands, and synod', async () => {
    await copyClaudeTemplates({ claudeDir, core: true, withTeams: true });

    expect(await ls(join(claudeDir, 'agents'))).toEqual([]);
    expect((await ls(join(claudeDir, 'commands'))).filter((c) => c.startsWith('team-'))).toEqual(
      [],
    );
    const skills = await ls(join(claudeDir, 'skills'));
    expect(skills).not.toContain('synod');
    expect(skills).not.toContain('using-teams');
  });

  it('--core ignores --teams rather than half-installing the team surface', async () => {
    await copyClaudeTemplates({ claudeDir, core: true, withTeams: true });
    const commands = await ls(join(claudeDir, 'commands'));
    expect(commands.some((c) => c.startsWith('team-'))).toBe(false);
  });

  it('a full install still ships everything core drops', async () => {
    await copyClaudeTemplates({ claudeDir, withTeams: true });

    expect((await ls(join(claudeDir, 'agents'))).length).toBeGreaterThan(0);
    expect((await ls(join(claudeDir, 'commands'))).some((c) => c.startsWith('team-'))).toBe(true);
    expect(await ls(join(claudeDir, 'skills'))).toContain('synod');
  });

  it('core installs strictly fewer files than full', async () => {
    const fullDir = await mkdtemp(join(tmpdir(), 'mm-full-'));
    const core = await copyClaudeTemplates({ claudeDir, core: true, withTeams: true });
    const full = await copyClaudeTemplates({ claudeDir: fullDir, withTeams: true });

    expect(core.copied.length).toBeLessThan(full.copied.length);
    await rm(fullDir, { recursive: true, force: true });
  });
});
