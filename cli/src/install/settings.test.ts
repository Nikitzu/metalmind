import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_TEAMS_ENV_KEY,
  applyAgentTeams,
  applyMemoryRouting,
  applyMetalmindSessionStartHook,
  applyOutputStyleUserPromptSubmitHook,
  type ClaudeSettings,
  clearAgentTeams,
  clearMemoryRouting,
  clearMetalmindSessionStartHook,
  clearOutputStyleUserPromptSubmitHook,
} from './settings.js';

async function readJson(path: string): Promise<ClaudeSettings> {
  return JSON.parse(await readFile(path, 'utf8'));
}

describe('settings', () => {
  let tmp: string;
  let settingsPath: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-settings-'));
    settingsPath = join(tmp, 'settings.json');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  describe('applyMemoryRouting', () => {
    it('sets CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 when disableNative', async () => {
      const result = await applyMemoryRouting({ settingsPath, disableNative: true });
      expect(result.changed).toBe(true);
      const data = await readJson(settingsPath);
      expect(data.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
    });

    it('removes the key when disableNative=false and it was set', async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({ env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } }),
        'utf8',
      );
      const result = await applyMemoryRouting({ settingsPath, disableNative: false });
      expect(result.changed).toBe(true);
      const data = await readJson(settingsPath);
      expect(data.env).toBeUndefined();
    });

    it('is idempotent when already in desired state', async () => {
      await applyMemoryRouting({ settingsPath, disableNative: true });
      const second = await applyMemoryRouting({ settingsPath, disableNative: true });
      expect(second.changed).toBe(false);
    });
  });

  describe('clearMemoryRouting', () => {
    it('removes the key but leaves other env intact', async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({
          env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', FOO: 'bar' },
        }),
        'utf8',
      );
      const changed = await clearMemoryRouting(settingsPath);
      expect(changed).toBe(true);
      const data = await readJson(settingsPath);
      expect(data.env).toEqual({ FOO: 'bar' });
    });

    it('returns false when file does not exist', async () => {
      const changed = await clearMemoryRouting(join(tmp, 'nope.json'));
      expect(changed).toBe(false);
    });
  });

  describe('applyAgentTeams', () => {
    it('sets env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 and teammateMode=tmux on enable', async () => {
      const result = await applyAgentTeams({ settingsPath, enable: true });

      expect(result.changed).toBe(true);
      expect(result.envSet).toBe(true);
      expect(result.teammateModeSet).toBe(true);
      const data = await readJson(settingsPath);
      expect(data.env?.[AGENT_TEAMS_ENV_KEY]).toBe('1');
      expect(data.teammateMode).toBe('tmux');
    });

    it('is idempotent when both keys are already set', async () => {
      await applyAgentTeams({ settingsPath, enable: true });
      const second = await applyAgentTeams({ settingsPath, enable: true });
      expect(second.changed).toBe(false);
      expect(second.envSet).toBe(false);
      expect(second.teammateModeSet).toBe(false);
    });

    it('preserves other env vars and other settings on enable', async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({
          env: { OTHER_VAR: 'keep-me' },
          permissions: { allow: ['*'] },
        }),
        'utf8',
      );
      await applyAgentTeams({ settingsPath, enable: true });
      const data = await readJson(settingsPath);
      expect(data.env?.OTHER_VAR).toBe('keep-me');
      expect(data.env?.[AGENT_TEAMS_ENV_KEY]).toBe('1');
      expect(data.permissions).toEqual({ allow: ['*'] });
    });

    it('removes both keys on disable, leaves other env intact', async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({
          env: { [AGENT_TEAMS_ENV_KEY]: '1', OTHER_VAR: 'keep-me' },
          teammateMode: 'tmux',
        }),
        'utf8',
      );
      const result = await applyAgentTeams({ settingsPath, enable: false });
      expect(result.changed).toBe(true);
      const data = await readJson(settingsPath);
      expect(data.env?.OTHER_VAR).toBe('keep-me');
      expect(data.env?.[AGENT_TEAMS_ENV_KEY]).toBeUndefined();
      expect(data.teammateMode).toBeUndefined();
    });

    it('does not strip a non-tmux teammateMode the user set themselves on disable', async () => {
      await writeFile(settingsPath, JSON.stringify({ teammateMode: 'in-process' }), 'utf8');
      const result = await applyAgentTeams({ settingsPath, enable: false });
      expect(result.changed).toBe(false);
      const data = await readJson(settingsPath);
      expect(data.teammateMode).toBe('in-process');
    });
  });

  describe('clearAgentTeams', () => {
    it('removes our keys and reports changed=true', async () => {
      await applyAgentTeams({ settingsPath, enable: true });
      const changed = await clearAgentTeams(settingsPath);
      expect(changed).toBe(true);
      const data = await readJson(settingsPath);
      expect(data.teammateMode).toBeUndefined();
      expect(data.env?.[AGENT_TEAMS_ENV_KEY]).toBeUndefined();
    });

    it('returns false when nothing to clear', async () => {
      await writeFile(settingsPath, JSON.stringify({}), 'utf8');
      const changed = await clearAgentTeams(settingsPath);
      expect(changed).toBe(false);
    });
  });

  describe('applyMetalmindSessionStartHook', () => {
    const hookCommand = 'bash /Users/x/.claude/hooks/metalmind-session-start.sh';

    it('registers a new SessionStart group in an empty settings file', async () => {
      const result = await applyMetalmindSessionStartHook({ settingsPath, hookCommand });
      expect(result.changed).toBe(true);

      const data = await readJson(settingsPath);
      expect(data.hooks?.SessionStart).toHaveLength(1);
      expect(data.hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toBe(hookCommand);
    });

    it('preserves pre-existing unrelated SessionStart hooks', async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({
          hooks: {
            SessionStart: [
              {
                matcher: '',
                hooks: [{ type: 'command', command: 'bash /other/hook.sh' }],
              },
            ],
          },
        }),
        'utf8',
      );
      await applyMetalmindSessionStartHook({ settingsPath, hookCommand });

      const data = await readJson(settingsPath);
      expect(data.hooks?.SessionStart).toHaveLength(2);
      const commands = data.hooks?.SessionStart?.flatMap((g) =>
        (g.hooks ?? []).map((h) => h.command),
      );
      expect(commands).toContain('bash /other/hook.sh');
      expect(commands).toContain(hookCommand);
    });

    it('is idempotent: re-apply with identical command returns changed=false', async () => {
      await applyMetalmindSessionStartHook({ settingsPath, hookCommand });
      const second = await applyMetalmindSessionStartHook({ settingsPath, hookCommand });
      expect(second.changed).toBe(false);
    });

    it('replaces a stale entry when the hookCommand changes', async () => {
      await applyMetalmindSessionStartHook({
        settingsPath,
        hookCommand: 'bash /old/path/metalmind-session-start.sh',
      });
      const second = await applyMetalmindSessionStartHook({
        settingsPath,
        hookCommand: 'bash /new/path/metalmind-session-start.sh',
      });
      expect(second.changed).toBe(true);

      const data = await readJson(settingsPath);
      const metalmindEntries = data.hooks?.SessionStart?.filter((g) =>
        g.hooks.some((h) => h.command.includes('metalmind-session-start.sh')),
      );
      expect(metalmindEntries).toHaveLength(1);
      expect(metalmindEntries?.[0]?.hooks?.[0]?.command).toContain('/new/path');
    });

    it('preserves other top-level settings (env, permissions, statusLine)', async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({
          env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
          permissions: { defaultMode: 'default' },
          statusLine: { type: 'command', command: 'bash status.sh' },
        }),
        'utf8',
      );
      await applyMetalmindSessionStartHook({ settingsPath, hookCommand });

      const data = await readJson(settingsPath);
      expect(data.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
      expect(data.permissions).toEqual({ defaultMode: 'default' });
      expect(data.statusLine).toEqual({ type: 'command', command: 'bash status.sh' });
    });
  });

  describe('clearMetalmindSessionStartHook', () => {
    it('removes only the metalmind entry, keeps other SessionStart groups', async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({
          hooks: {
            SessionStart: [
              { matcher: '', hooks: [{ type: 'command', command: 'bash /other.sh' }] },
              {
                matcher: '',
                hooks: [{ type: 'command', command: 'bash /x/metalmind-session-start.sh' }],
              },
            ],
          },
        }),
        'utf8',
      );
      const changed = await clearMetalmindSessionStartHook(settingsPath);
      expect(changed).toBe(true);

      const data = await readJson(settingsPath);
      expect(data.hooks?.SessionStart).toHaveLength(1);
      expect(data.hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toBe('bash /other.sh');
    });

    it('deletes the SessionStart array entirely when it was the only entry', async () => {
      await applyMetalmindSessionStartHook({
        settingsPath,
        hookCommand: 'bash /metalmind-session-start.sh',
      });
      const changed = await clearMetalmindSessionStartHook(settingsPath);
      expect(changed).toBe(true);

      const data = await readJson(settingsPath);
      expect(data.hooks).toBeUndefined();
    });

    it('returns false when no metalmind entry exists', async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({
          hooks: {
            SessionStart: [
              { matcher: '', hooks: [{ type: 'command', command: 'bash /other.sh' }] },
            ],
          },
        }),
        'utf8',
      );
      const changed = await clearMetalmindSessionStartHook(settingsPath);
      expect(changed).toBe(false);
    });

    it('returns false when settings file does not exist', async () => {
      const changed = await clearMetalmindSessionStartHook(join(tmp, 'nope.json'));
      expect(changed).toBe(false);
    });
  });

  describe('applyOutputStyleUserPromptSubmitHook', () => {
    const hookCommand = 'bash /x/metalmind-output-style-reanchor.sh';

    it('registers a new UserPromptSubmit group in an empty settings file', async () => {
      const result = await applyOutputStyleUserPromptSubmitHook({ settingsPath, hookCommand });
      expect(result.changed).toBe(true);

      const data = await readJson(settingsPath);
      expect(data.hooks?.UserPromptSubmit).toHaveLength(1);
      expect(data.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe(hookCommand);
    });

    it('preserves pre-existing unrelated UserPromptSubmit hooks', async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({
          hooks: {
            UserPromptSubmit: [
              { matcher: '', hooks: [{ type: 'command', command: 'bash /other.sh' }] },
            ],
          },
        }),
        'utf8',
      );
      await applyOutputStyleUserPromptSubmitHook({ settingsPath, hookCommand });

      const data = await readJson(settingsPath);
      expect(data.hooks?.UserPromptSubmit).toHaveLength(2);
      const commands = data.hooks?.UserPromptSubmit?.flatMap((g) => g.hooks.map((h) => h.command));
      expect(commands).toContain('bash /other.sh');
      expect(commands).toContain(hookCommand);
    });

    it('is idempotent: re-apply with identical command returns changed=false', async () => {
      await applyOutputStyleUserPromptSubmitHook({ settingsPath, hookCommand });
      const second = await applyOutputStyleUserPromptSubmitHook({ settingsPath, hookCommand });
      expect(second.changed).toBe(false);
    });

    it('replaces a stale entry when the hookCommand changes', async () => {
      await applyOutputStyleUserPromptSubmitHook({
        settingsPath,
        hookCommand: 'bash /old/metalmind-output-style-reanchor.sh',
      });
      const second = await applyOutputStyleUserPromptSubmitHook({
        settingsPath,
        hookCommand: 'bash /new/metalmind-output-style-reanchor.sh',
      });
      expect(second.changed).toBe(true);

      const data = await readJson(settingsPath);
      const entries = data.hooks?.UserPromptSubmit?.filter((g) =>
        g.hooks.some((h) => h.command.includes('metalmind-output-style-reanchor.sh')),
      );
      expect(entries).toHaveLength(1);
      expect(entries?.[0]?.hooks?.[0]?.command).toContain('/new/');
    });
  });

  describe('clearOutputStyleUserPromptSubmitHook', () => {
    it('removes only the re-anchor entry, keeps other UserPromptSubmit groups', async () => {
      await writeFile(
        settingsPath,
        JSON.stringify({
          hooks: {
            UserPromptSubmit: [
              { matcher: '', hooks: [{ type: 'command', command: 'bash /other.sh' }] },
              {
                matcher: '',
                hooks: [
                  {
                    type: 'command',
                    command: 'bash /x/metalmind-output-style-reanchor.sh',
                  },
                ],
              },
            ],
          },
        }),
        'utf8',
      );
      const changed = await clearOutputStyleUserPromptSubmitHook(settingsPath);
      expect(changed).toBe(true);

      const data = await readJson(settingsPath);
      expect(data.hooks?.UserPromptSubmit).toHaveLength(1);
      expect(data.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe('bash /other.sh');
    });

    it('deletes UserPromptSubmit array entirely when it was the only entry', async () => {
      await applyOutputStyleUserPromptSubmitHook({
        settingsPath,
        hookCommand: 'bash /metalmind-output-style-reanchor.sh',
      });
      const changed = await clearOutputStyleUserPromptSubmitHook(settingsPath);
      expect(changed).toBe(true);

      const data = await readJson(settingsPath);
      expect(data.hooks).toBeUndefined();
    });

    it('returns false when no re-anchor entry exists', async () => {
      const changed = await clearOutputStyleUserPromptSubmitHook(settingsPath);
      expect(changed).toBe(false);
    });

    it('returns false when settings file does not exist', async () => {
      const changed = await clearOutputStyleUserPromptSubmitHook(join(tmp, 'nope.json'));
      expect(changed).toBe(false);
    });
  });
});
