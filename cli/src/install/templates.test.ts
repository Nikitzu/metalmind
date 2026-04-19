import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../util/exec.js';

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
      join(claudeSrc, 'CLAUDE.md.template'),
      '# global\n\nvault at {{VAULT_PATH}}\n',
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

    it('skips existing files with skipped list', async () => {
      await mkdir(join(claudeDir, 'rules'), { recursive: true });
      await writeFile(join(claudeDir, 'rules', 'principles.md'), '# user-custom\n', 'utf8');

      const { copyClaudeTemplates } = await import('./templates.js');
      const result = await copyClaudeTemplates({ templatesDir, claudeDir });

      expect(result.skipped).toContain('rules/principles.md');
      expect(await readFile(join(claudeDir, 'rules', 'principles.md'), 'utf8')).toBe(
        '# user-custom\n',
      );
    });
  });

  describe('stampClaudeMd', () => {
    it('renders with VAULT_PATH substituted', async () => {
      const { stampClaudeMd } = await import('./templates.js');
      const result = await stampClaudeMd({
        vaultPath: '/Users/me/Knowledge',
        templatesDir,
        claudeDir,
      });

      expect(result.wrote).toBe(true);
      const contents = await readFile(result.path, 'utf8');
      expect(contents).toContain('vault at /Users/me/Knowledge');
      expect(contents).not.toContain('{{VAULT_PATH}}');
    });

    it('preserves existing CLAUDE.md', async () => {
      await mkdir(claudeDir, { recursive: true });
      await writeFile(join(claudeDir, 'CLAUDE.md'), '# hand-written\n', 'utf8');

      const { stampClaudeMd } = await import('./templates.js');
      const result = await stampClaudeMd({
        vaultPath: '/v',
        templatesDir,
        claudeDir,
      });

      expect(result.wrote).toBe(false);
      expect(await readFile(result.path, 'utf8')).toBe('# hand-written\n');
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
});
