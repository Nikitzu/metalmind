import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupOutputStyle } from './output-style-cleanup.js';

const ACTIVATE_HOOK = 'bash /x/metalmind-output-style-activate.sh';
const REANCHOR_HOOK = 'bash /x/metalmind-output-style-reanchor.sh';

describe('cleanupOutputStyle', () => {
  let tmp: string;
  let outputStylesDir: string;
  let skillsDir: string;
  let hooksDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mm-style-cleanup-'));
    outputStylesDir = join(tmp, 'output-styles');
    skillsDir = join(tmp, 'skills');
    hooksDir = join(tmp, 'hooks');
    settingsPath = join(tmp, 'settings.json');
    await mkdir(outputStylesDir, { recursive: true });
    await mkdir(skillsDir, { recursive: true });
    await mkdir(hooksDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  function opts(priorValue: string | null = null) {
    return { priorValue, outputStylesDir, skillsDir, hooksDir, settingsPath };
  }

  async function seedFullInstall(outputStyle = 'marsh'): Promise<void> {
    await writeFile(join(outputStylesDir, 'marsh.md'), '# marsh', 'utf8');
    await writeFile(join(outputStylesDir, 'telegraph.md'), '# telegraph', 'utf8');
    await mkdir(join(skillsDir, 'marsh'), { recursive: true });
    await writeFile(join(skillsDir, 'marsh', 'SKILL.md'), '# skill', 'utf8');
    await mkdir(join(skillsDir, 'telegraph'), { recursive: true });
    await writeFile(join(skillsDir, 'telegraph', 'SKILL.md'), '# skill', 'utf8');
    await writeFile(join(hooksDir, 'metalmind-output-style-activate.sh'), '#!/bin/sh', 'utf8');
    await writeFile(join(hooksDir, 'metalmind-output-style-reanchor.sh'), '#!/bin/sh', 'utf8');
    await writeFile(
      settingsPath,
      JSON.stringify({
        outputStyle,
        hooks: {
          SessionStart: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'bash /x/metalmind-session-start.sh' }],
            },
            { matcher: '', hooks: [{ type: 'command', command: ACTIVATE_HOOK }] },
          ],
          UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: REANCHOR_HOOK }] }],
        },
      }),
      'utf8',
    );
  }

  async function readSettings(): Promise<Record<string, never>> {
    return JSON.parse(await readFile(settingsPath, 'utf8'));
  }

  it('no-ops on an install that never had the feature', async () => {
    const result = await cleanupOutputStyle(opts());
    expect(result.cleaned).toBe(false);
    expect(result.stylesRemoved).toEqual([]);
    expect(result.settingsChanged).toBe(false);
  });

  it('removes styles, skills, hook scripts, and both registrations', async () => {
    await seedFullInstall();
    const result = await cleanupOutputStyle(opts());

    expect(result.cleaned).toBe(true);
    expect(result.stylesRemoved).toEqual(['marsh', 'telegraph']);
    expect(result.skillsRemoved).toEqual(['marsh', 'telegraph']);
    expect(result.hookScriptsRemoved).toHaveLength(2);
    expect(result.sessionStartHookCleared).toBe(true);
    expect(result.userPromptSubmitHookCleared).toBe(true);

    expect(existsSync(join(outputStylesDir, 'marsh.md'))).toBe(false);
    expect(existsSync(join(skillsDir, 'telegraph'))).toBe(false);
    expect(existsSync(join(hooksDir, 'metalmind-output-style-activate.sh'))).toBe(false);
  });

  it('leaves the unrelated SessionStart memory hook in place', async () => {
    await seedFullInstall();
    await cleanupOutputStyle(opts());

    const data = await readSettings();
    const groups = (data as Record<string, never>).hooks as unknown as {
      SessionStart?: { hooks: { command: string }[] }[];
      UserPromptSubmit?: unknown;
    };
    expect(groups.SessionStart).toHaveLength(1);
    expect(groups.SessionStart?.[0]?.hooks?.[0]?.command).toContain('metalmind-session-start.sh');
    expect(groups.UserPromptSubmit).toBeUndefined();
  });

  it('deletes settings.outputStyle when there is no prior value to restore', async () => {
    await seedFullInstall();
    const result = await cleanupOutputStyle(opts());

    expect(result.settingsChanged).toBe(true);
    expect(result.settingsOutputStyle).toBeNull();
    expect((await readSettings()).outputStyle).toBeUndefined();
  });

  it('restores settings.outputStyle to the prior value when one was recorded', async () => {
    await seedFullInstall();
    const result = await cleanupOutputStyle(opts('explanatory'));

    expect(result.settingsOutputStyle).toBe('explanatory');
    expect((await readSettings()).outputStyle).toBe('explanatory');
  });

  it('deletes rather than restores when the prior value is itself a retired style', async () => {
    await seedFullInstall();
    const result = await cleanupOutputStyle(opts('terse'));

    expect(result.settingsOutputStyle).toBeNull();
    expect((await readSettings()).outputStyle).toBeUndefined();
  });

  it('never touches an output style the user chose themselves', async () => {
    await seedFullInstall('explanatory');
    const result = await cleanupOutputStyle(opts());

    expect(result.settingsChanged).toBe(false);
    expect(result.settingsOutputStyle).toBe('explanatory');
    expect((await readSettings()).outputStyle).toBe('explanatory');
  });

  it('sweeps the pre-0.8.14 terse and caveman styles too', async () => {
    await writeFile(join(outputStylesDir, 'terse.md'), '# terse', 'utf8');
    await writeFile(join(outputStylesDir, 'caveman.md'), '# caveman', 'utf8');
    const result = await cleanupOutputStyle(opts());

    expect(result.stylesRemoved).toEqual(['terse', 'caveman']);
  });

  it('is idempotent: a second run reports nothing left to clean', async () => {
    await seedFullInstall();
    await cleanupOutputStyle(opts());
    const second = await cleanupOutputStyle(opts());

    expect(second.cleaned).toBe(false);
  });
});
