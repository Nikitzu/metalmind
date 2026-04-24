import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../util/exec.js';
import { renderSkillSentinels } from './templates.js';

const runCommand = vi.hoisted(() =>
  vi.fn<(cmd: string, args?: string[], opts?: { timeoutMs?: number }) => Promise<CommandResult>>(),
);

vi.mock('../util/exec.js', () => ({ runCommand }));

describe('templates', () => {
  let tmp: string;
  let templatesDir: string;
  let claudeDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-tpl-'));
    templatesDir = join(tmp, 'templates');
    claudeDir = join(tmp, '.claude');
    const claudeSrc = join(templatesDir, 'claude');
    await mkdir(join(claudeSrc, 'rules'), { recursive: true });
    await mkdir(join(claudeSrc, 'agents'), { recursive: true });
    await mkdir(join(claudeSrc, 'commands'), { recursive: true });
    await writeFile(join(claudeSrc, 'rules', 'principles.md'), '# principles\n', 'utf8');
    await writeFile(join(claudeSrc, 'rules', 'tool-philosophy.md'), '# tools\n', 'utf8');
    await writeFile(join(claudeSrc, 'agents', 'architect.md'), '# architect\n', 'utf8');
    await writeFile(join(claudeSrc, 'commands', 'save.md'), '# save\n', 'utf8');
    await writeFile(join(claudeSrc, 'commands', 'team-debug.md'), '# team-debug\n', 'utf8');
    await writeFile(
      join(claudeSrc, 'CLAUDE.md.starter.template'),
      '# starter prefs\n\ngeneric stance section\n',
      'utf8',
    );
    await writeFile(
      join(claudeSrc, 'CLAUDE.md.block.template'),
      '## Memory\n\nvault at {{VAULT_PATH}}\nrecall via {{RECALL_CMD}}\n',
      'utf8',
    );
    await mkdir(join(claudeSrc, 'hooks'), { recursive: true });
    await writeFile(
      join(claudeSrc, 'hooks', 'session-start.sh.template'),
      '#!/usr/bin/env bash\n# recall via {{RECALL_CMD}}\n',
      'utf8',
    );
    runCommand.mockReset();
    runCommand.mockResolvedValue({ stdout: '', stderr: '', ok: true, exitCode: 0 });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  describe('copyClaudeTemplates', () => {
    it('copies rules, agents, and save.md; skips team-* by default', async () => {
      const { copyClaudeTemplates } = await import('./templates.js');
      const result = await copyClaudeTemplates({ templatesDir, claudeDir });

      expect(result.copied).toEqual([
        'rules/principles.md',
        'rules/tool-philosophy.md',
        'agents/architect.md',
        'commands/save.md',
      ]);
      expect(existsSync(join(claudeDir, 'rules', 'principles.md'))).toBe(true);
      expect(existsSync(join(claudeDir, 'commands', 'team-debug.md'))).toBe(false);
    });

    it('includes team commands when withTeams=true', async () => {
      const { copyClaudeTemplates } = await import('./templates.js');
      const result = await copyClaudeTemplates({ templatesDir, claudeDir, withTeams: true });

      expect(result.copied).toContain('commands/team-debug.md');
      expect(existsSync(join(claudeDir, 'commands', 'team-debug.md'))).toBe(true);
    });

    it('overwrites existing files on re-run (metalmind-owned)', async () => {
      await mkdir(join(claudeDir, 'rules'), { recursive: true });
      await writeFile(join(claudeDir, 'rules', 'principles.md'), '# stale\n', 'utf8');

      const { copyClaudeTemplates } = await import('./templates.js');
      const result = await copyClaudeTemplates({ templatesDir, claudeDir });

      expect(result.copied).toContain('rules/principles.md');
      expect(await readFile(join(claudeDir, 'rules', 'principles.md'), 'utf8')).toBe(
        '# principles\n',
      );
    });

    it('copies skill bundles (directories under templates/claude/skills) recursively', async () => {
      const claudeSrc = join(templatesDir, 'claude');
      await mkdir(join(claudeSrc, 'skills', 'writing-vault-notes'), { recursive: true });
      await writeFile(
        join(claudeSrc, 'skills', 'writing-vault-notes', 'SKILL.md'),
        '---\nname: writing-vault-notes\ndescription: test\n---\n# body\n',
        'utf8',
      );
      await mkdir(join(claudeSrc, 'skills', 'writing-vault-notes', 'references'), {
        recursive: true,
      });
      await writeFile(
        join(claudeSrc, 'skills', 'writing-vault-notes', 'references', 'extra.md'),
        '# extra\n',
        'utf8',
      );

      const { copyClaudeTemplates } = await import('./templates.js');
      const result = await copyClaudeTemplates({ templatesDir, claudeDir });

      expect(result.copied).toContain('skills/writing-vault-notes');
      expect(existsSync(join(claudeDir, 'skills', 'writing-vault-notes', 'SKILL.md'))).toBe(true);
      expect(
        existsSync(join(claudeDir, 'skills', 'writing-vault-notes', 'references', 'extra.md')),
      ).toBe(true);
    });

    it('renders {{RECALL_CMD}} in save.md per flavor', async () => {
      // replace the default save.md with one that uses the placeholder
      await writeFile(
        join(templatesDir, 'claude', 'commands', 'save.md'),
        'Run `Bash: {{RECALL_CMD}} "<q>"` first.\n',
        'utf8',
      );
      const { copyClaudeTemplates } = await import('./templates.js');
      await copyClaudeTemplates({ templatesDir, claudeDir, flavor: 'classic' });
      const contents = await readFile(join(claudeDir, 'commands', 'save.md'), 'utf8');
      expect(contents).toContain('metalmind recall');
      expect(contents).not.toContain('{{RECALL_CMD}}');
    });
  });

  describe('stampClaudeMd', () => {
    it('writes starter + metalmind block on fresh install (scadrial)', async () => {
      const { stampClaudeMd } = await import('./templates.js');
      const result = await stampClaudeMd({
        vaultPath: '/Users/me/Knowledge',
        flavor: 'scadrial',
        templatesDir,
        claudeDir,
      });

      expect(result.starterWritten).toBe(true);
      expect(result.blockAction).toBe('inserted');
      const contents = await readFile(result.path, 'utf8');
      expect(contents).toContain('starter prefs');
      expect(contents).toContain('vault at /Users/me/Knowledge');
      expect(contents).toContain('metalmind tap copper');
      expect(contents).toContain('<!-- metalmind:managed:begin -->');
      expect(contents).toContain('<!-- metalmind:managed:end -->');
      expect(contents).not.toContain('{{VAULT_PATH}}');
      expect(contents).not.toContain('{{RECALL_CMD}}');
    });

    it('renders classic flavor with recall verb', async () => {
      const { stampClaudeMd } = await import('./templates.js');
      await stampClaudeMd({
        vaultPath: '/v',
        flavor: 'classic',
        templatesDir,
        claudeDir,
      });
      const contents = await readFile(join(claudeDir, 'CLAUDE.md'), 'utf8');
      expect(contents).toContain('metalmind recall');
      expect(contents).not.toContain('tap copper');
    });

    it('upserts block into existing user CLAUDE.md without stomping user content', async () => {
      await mkdir(claudeDir, { recursive: true });
      await writeFile(join(claudeDir, 'CLAUDE.md'), '# hand-written\npersonal stuff\n', 'utf8');

      const { stampClaudeMd } = await import('./templates.js');
      const result = await stampClaudeMd({
        vaultPath: '/v',
        flavor: 'scadrial',
        templatesDir,
        claudeDir,
      });

      expect(result.starterWritten).toBe(false);
      expect(result.blockAction).toBe('inserted');
      const contents = await readFile(result.path, 'utf8');
      expect(contents).toContain('# hand-written');
      expect(contents).toContain('personal stuff');
      expect(contents).toContain('metalmind tap copper');
      expect(contents).toContain('<!-- metalmind:managed:begin -->');
    });

    it('refreshes stale block on re-run with new flavor, preserves user content', async () => {
      const { stampClaudeMd } = await import('./templates.js');
      await stampClaudeMd({ vaultPath: '/v', flavor: 'scadrial', templatesDir, claudeDir });
      const after1 = await readFile(join(claudeDir, 'CLAUDE.md'), 'utf8');
      await writeFile(join(claudeDir, 'CLAUDE.md'), `${after1}\n# added later\n`, 'utf8');

      const second = await stampClaudeMd({
        vaultPath: '/v',
        flavor: 'classic',
        templatesDir,
        claudeDir,
      });

      expect(second.starterWritten).toBe(false);
      expect(second.blockAction).toBe('updated');
      const contents = await readFile(join(claudeDir, 'CLAUDE.md'), 'utf8');
      expect(contents).toContain('metalmind recall');
      expect(contents).not.toContain('tap copper');
      expect(contents).toContain('# added later');
      expect(contents).toContain('starter prefs');
    });
  });

  describe('appendGlobalGitignore', () => {
    it('creates file and appends all default patterns', async () => {
      const gitignorePath = join(tmp, '.gitignore_global');
      const { appendGlobalGitignore } = await import('./templates.js');
      const result = await appendGlobalGitignore({ gitignorePath, skipGitConfig: true });

      expect(result.added).toEqual(['.claude/', '.serena/', 'CLAUDE.md', 'CLAUDE.local.md']);
      expect(result.existing).toEqual([]);
      const contents = await readFile(gitignorePath, 'utf8');
      expect(contents).toContain('.claude/');
      expect(contents).toContain('CLAUDE.local.md');
    });

    it('skips patterns already present', async () => {
      const gitignorePath = join(tmp, '.gitignore_global');
      await writeFile(gitignorePath, '.claude/\n# other\n', 'utf8');

      const { appendGlobalGitignore } = await import('./templates.js');
      const result = await appendGlobalGitignore({ gitignorePath, skipGitConfig: true });

      expect(result.existing).toEqual(['.claude/']);
      expect(result.added).toEqual(['.serena/', 'CLAUDE.md', 'CLAUDE.local.md']);
      const contents = await readFile(gitignorePath, 'utf8');
      expect(contents.split('\n').filter((l) => l === '.claude/').length).toBe(1);
    });

    it('adds leading newline when existing file lacks trailing newline', async () => {
      const gitignorePath = join(tmp, '.gitignore_global');
      await writeFile(gitignorePath, 'existing-pattern', 'utf8');

      const { appendGlobalGitignore } = await import('./templates.js');
      await appendGlobalGitignore({ gitignorePath, skipGitConfig: true });

      const contents = await readFile(gitignorePath, 'utf8');
      expect(contents).toBe('existing-pattern\n.claude/\n.serena/\nCLAUDE.md\nCLAUDE.local.md\n');
    });
  });

  describe('copyClaudeHooks', () => {
    it('renders the SessionStart hook with the flavor-appropriate recall command', async () => {
      const hooksDir = join(claudeDir, 'hooks');
      const { copyClaudeHooks } = await import('./templates.js');
      const result = await copyClaudeHooks({ templatesDir, hooksDir, flavor: 'scadrial' });

      expect(result.action).toBe('created');
      expect(result.hookScriptPath).toBe(join(hooksDir, 'metalmind-session-start.sh'));
      expect(result.hookCommand).toBe(`bash ${result.hookScriptPath}`);
      const body = await readFile(result.hookScriptPath, 'utf8');
      expect(body).toContain('recall via metalmind tap copper');
      expect(body).not.toContain('{{RECALL_CMD}}');
    });

    it('uses the classic recall verb when flavor=classic', async () => {
      const hooksDir = join(claudeDir, 'hooks');
      const { copyClaudeHooks } = await import('./templates.js');
      const result = await copyClaudeHooks({ templatesDir, hooksDir, flavor: 'classic' });

      const body = await readFile(result.hookScriptPath, 'utf8');
      expect(body).toContain('recall via metalmind recall');
    });

    it('is idempotent: re-run with same content returns unchanged', async () => {
      const hooksDir = join(claudeDir, 'hooks');
      const { copyClaudeHooks } = await import('./templates.js');
      await copyClaudeHooks({ templatesDir, hooksDir, flavor: 'scadrial' });
      const second = await copyClaudeHooks({ templatesDir, hooksDir, flavor: 'scadrial' });

      expect(second.action).toBe('unchanged');
    });

    it('overwrites when flavor switches', async () => {
      const hooksDir = join(claudeDir, 'hooks');
      const { copyClaudeHooks } = await import('./templates.js');
      await copyClaudeHooks({ templatesDir, hooksDir, flavor: 'scadrial' });
      const second = await copyClaudeHooks({ templatesDir, hooksDir, flavor: 'classic' });

      expect(second.action).toBe('updated');
      const body = await readFile(second.hookScriptPath, 'utf8');
      expect(body).toContain('metalmind recall');
    });
  });
});

describe('renderSkillSentinels', () => {
  const src = [
    'Header',
    '',
    '<!-- metalmind:notifications:start -->',
    'notify line',
    '<!-- metalmind:notifications:end -->',
    '',
    '<!-- metalmind:eod:start -->',
    '## EOD',
    'content',
    '<!-- metalmind:notifications:start -->',
    'nested notify',
    '<!-- metalmind:notifications:end -->',
    '<!-- metalmind:eod:end -->',
    '',
    'Footer',
    '',
  ].join('\n');

  it('keeps both blocks when both flags are true', () => {
    const out = renderSkillSentinels(src, { eodHook: true, notifications: true });
    expect(out).toContain('notify line');
    expect(out).toContain('## EOD');
    expect(out).toContain('nested notify');
    expect(out).not.toContain('metalmind:eod');
    expect(out).not.toContain('metalmind:notifications');
  });

  it('drops notify blocks when notifications=false', () => {
    const out = renderSkillSentinels(src, { eodHook: true, notifications: false });
    expect(out).not.toContain('notify line');
    expect(out).not.toContain('nested notify');
    expect(out).toContain('## EOD');
  });

  it('drops EOD block entirely when eodHook=false', () => {
    const out = renderSkillSentinels(src, { eodHook: false, notifications: true });
    expect(out).not.toContain('## EOD');
    expect(out).not.toContain('nested notify');
    expect(out).toContain('notify line');
  });

  it('drops both when both false', () => {
    const out = renderSkillSentinels(src, { eodHook: false, notifications: false });
    expect(out).not.toContain('notify line');
    expect(out).not.toContain('## EOD');
    expect(out).toContain('Header');
    expect(out).toContain('Footer');
  });
});
