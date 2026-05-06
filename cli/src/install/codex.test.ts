import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyCodexHooksJson,
  clearCodexAgentsMd,
  clearCodexHooksJson,
  copyCodexHook,
  removeCodexHookScript,
  stampCodexAgentsMd,
} from './codex.js';

// Resolve real templates dir (cli/templates/) relative to this test file.
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

describe('stampCodexAgentsMd', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-agents-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('creates AGENTS.md with sentinel-bounded metalmind block', async () => {
    const result = await stampCodexAgentsMd({
      vaultPath: '/Users/test/Knowledge',
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    expect(result.blockAction).toBe('created');
    const content = await readFile(result.path, 'utf8');
    expect(content).toContain('<!-- metalmind:codex:agents:begin -->');
    expect(content).toContain('<!-- metalmind:codex:agents:end -->');
    expect(content).toContain('/Users/test/Knowledge');
    expect(content).toContain('metalmind recall');
  });

  it('uses scadrial recall command when flavor=scadrial', async () => {
    await stampCodexAgentsMd({
      vaultPath: '/x',
      flavor: 'scadrial',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    const content = await readFile(join(codexDir, 'AGENTS.md'), 'utf8');
    expect(content).toContain('metalmind tap copper');
    // No 'metalmind recall ' (with trailing space) — scadrial flavor must not leak the classic verb.
    expect(content).not.toMatch(/metalmind recall\b/);
  });

  it('is idempotent on second call', async () => {
    await stampCodexAgentsMd({
      vaultPath: '/x',
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    const second = await stampCodexAgentsMd({
      vaultPath: '/x',
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    expect(second.blockAction).toBe('unchanged');
  });

  it('preserves user content outside the sentinel block', async () => {
    const target = join(codexDir, 'AGENTS.md');
    await mkdir(codexDir, { recursive: true });
    await writeFile(target, '# My personal AGENTS.md\nUser content here.\n', 'utf8');
    await stampCodexAgentsMd({
      vaultPath: '/x',
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    const content = await readFile(target, 'utf8');
    expect(content).toContain('# My personal AGENTS.md');
    expect(content).toContain('User content here.');
    expect(content).toContain('<!-- metalmind:codex:agents:begin -->');
  });

  it('updates content on vault path change', async () => {
    await stampCodexAgentsMd({
      vaultPath: '/old',
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    const result = await stampCodexAgentsMd({
      vaultPath: '/new',
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    expect(result.blockAction).toBe('updated');
    const content = await readFile(join(codexDir, 'AGENTS.md'), 'utf8');
    expect(content).toContain('/new');
    expect(content).not.toContain('/old');
  });
});

describe('clearCodexAgentsMd', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-agents-clear-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('returns false when AGENTS.md does not exist', async () => {
    expect(await clearCodexAgentsMd({ codexDir })).toBe(false);
  });

  it('removes the sentinel block + deletes empty file when block was the only content', async () => {
    await stampCodexAgentsMd({
      vaultPath: '/x',
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    expect(await clearCodexAgentsMd({ codexDir })).toBe(true);
    expect(existsSync(join(codexDir, 'AGENTS.md'))).toBe(false);
  });

  it('preserves user content while removing block', async () => {
    const target = join(codexDir, 'AGENTS.md');
    await mkdir(codexDir, { recursive: true });
    await writeFile(target, '# Personal\nUser line.\n', 'utf8');
    await stampCodexAgentsMd({
      vaultPath: '/x',
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    await clearCodexAgentsMd({ codexDir });
    const content = await readFile(target, 'utf8');
    expect(content).toContain('# Personal');
    expect(content).toContain('User line.');
    expect(content).not.toContain('metalmind:codex:agents');
  });
});

describe('copyCodexHook', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-hook-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('writes session-start.sh script with chmod 0755', async () => {
    const result = await copyCodexHook({
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    expect(result.action).toBe('created');
    expect(result.hookScriptPath).toBe(join(codexDir, 'hooks', 'metalmind-session-start.sh'));
    expect(result.hookCommand).toBe(`bash ${result.hookScriptPath}`);
    const s = await stat(result.hookScriptPath);
    expect(s.mode & 0o777).toBe(0o755);
  });

  it('renders {{RECALL_CMD}} per flavor', async () => {
    await copyCodexHook({ flavor: 'scadrial', templatesDir: TEMPLATES_DIR, codexDir });
    const content = await readFile(join(codexDir, 'hooks', 'metalmind-session-start.sh'), 'utf8');
    expect(content).toContain('metalmind tap copper');
    expect(content).not.toContain('{{RECALL_CMD}}');
  });

  it('reports unchanged on second identical call', async () => {
    await copyCodexHook({ flavor: 'classic', templatesDir: TEMPLATES_DIR, codexDir });
    const second = await copyCodexHook({
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    expect(second.action).toBe('unchanged');
  });

  it('reports updated when flavor changes', async () => {
    await copyCodexHook({ flavor: 'classic', templatesDir: TEMPLATES_DIR, codexDir });
    const second = await copyCodexHook({
      flavor: 'scadrial',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    expect(second.action).toBe('updated');
  });
});

describe('applyCodexHooksJson', () => {
  let codexDir: string;
  let hooksJsonPath: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-hjson-'));
    hooksJsonPath = join(codexDir, 'hooks.json');
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('creates hooks.json with SessionStart group when file absent', async () => {
    const result = await applyCodexHooksJson({
      hooksJsonPath,
      hookCommand: 'bash /tmp/metalmind-session-start.sh',
    });
    expect(result.changed).toBe(true);
    const data = JSON.parse(await readFile(hooksJsonPath, 'utf8'));
    expect(data.hooks.SessionStart).toHaveLength(1);
    expect(data.hooks.SessionStart[0].hooks[0].command).toBe(
      'bash /tmp/metalmind-session-start.sh',
    );
  });

  it('preserves other SessionStart entries', async () => {
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      hooksJsonPath,
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { matcher: 'startup', hooks: [{ type: 'command', command: '/usr/bin/other-tool' }] },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await applyCodexHooksJson({
      hooksJsonPath,
      hookCommand: 'bash /tmp/metalmind-session-start.sh',
    });
    const data = JSON.parse(await readFile(hooksJsonPath, 'utf8'));
    expect(data.hooks.SessionStart).toHaveLength(2);
    expect(
      data.hooks.SessionStart.some(
        (g: { hooks: Array<{ command: string }> }) => g.hooks[0].command === '/usr/bin/other-tool',
      ),
    ).toBe(true);
  });

  it('is idempotent on second identical call', async () => {
    const cmd = 'bash /tmp/metalmind-session-start.sh';
    await applyCodexHooksJson({ hooksJsonPath, hookCommand: cmd });
    const second = await applyCodexHooksJson({ hooksJsonPath, hookCommand: cmd });
    expect(second.changed).toBe(false);
  });

  it('updates command when changed', async () => {
    await applyCodexHooksJson({
      hooksJsonPath,
      hookCommand: 'bash /old/metalmind-session-start.sh',
    });
    const second = await applyCodexHooksJson({
      hooksJsonPath,
      hookCommand: 'bash /new/metalmind-session-start.sh',
    });
    expect(second.changed).toBe(true);
    const data = JSON.parse(await readFile(hooksJsonPath, 'utf8'));
    const ours = data.hooks.SessionStart.find((g: { hooks: Array<{ command: string }> }) =>
      g.hooks[0].command.includes('metalmind-session-start.sh'),
    );
    expect(ours.hooks[0].command).toBe('bash /new/metalmind-session-start.sh');
  });

  it('preserves non-SessionStart hooks events', async () => {
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      hooksJsonPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              { matcher: '', hooks: [{ type: 'command', command: '/usr/bin/audit' }] },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await applyCodexHooksJson({
      hooksJsonPath,
      hookCommand: 'bash /tmp/metalmind-session-start.sh',
    });
    const data = JSON.parse(await readFile(hooksJsonPath, 'utf8'));
    expect(data.hooks.PreToolUse).toHaveLength(1);
    expect(data.hooks.PreToolUse[0].hooks[0].command).toBe('/usr/bin/audit');
    expect(data.hooks.SessionStart).toHaveLength(1);
  });
});

describe('clearCodexHooksJson', () => {
  let codexDir: string;
  let hooksJsonPath: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-clear-'));
    hooksJsonPath = join(codexDir, 'hooks.json');
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('returns false when file absent', async () => {
    expect(await clearCodexHooksJson({ hooksJsonPath })).toBe(false);
  });

  it('removes our SessionStart entry; preserves others', async () => {
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      hooksJsonPath,
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { matcher: 'startup', hooks: [{ type: 'command', command: '/usr/bin/other-tool' }] },
              {
                matcher: '',
                hooks: [{ type: 'command', command: 'bash /x/metalmind-session-start.sh' }],
              },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    expect(await clearCodexHooksJson({ hooksJsonPath })).toBe(true);
    const data = JSON.parse(await readFile(hooksJsonPath, 'utf8'));
    expect(data.hooks.SessionStart).toHaveLength(1);
    expect(data.hooks.SessionStart[0].hooks[0].command).toBe('/usr/bin/other-tool');
  });

  it('deletes hooks.json when our entry was the only content', async () => {
    await applyCodexHooksJson({
      hooksJsonPath,
      hookCommand: 'bash /x/metalmind-session-start.sh',
    });
    await clearCodexHooksJson({ hooksJsonPath });
    expect(existsSync(hooksJsonPath)).toBe(false);
  });

  it('returns false when our entry not present (no-op)', async () => {
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      hooksJsonPath,
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { matcher: '', hooks: [{ type: 'command', command: '/usr/bin/other' }] },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    expect(await clearCodexHooksJson({ hooksJsonPath })).toBe(false);
  });
});

describe('removeCodexHookScript', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-hookscript-rm-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('returns false when script absent', async () => {
    expect(await removeCodexHookScript({ codexDir })).toBe(false);
  });

  it('deletes the hook script', async () => {
    await copyCodexHook({ flavor: 'classic', templatesDir: TEMPLATES_DIR, codexDir });
    expect(await removeCodexHookScript({ codexDir })).toBe(true);
    expect(existsSync(join(codexDir, 'hooks', 'metalmind-session-start.sh'))).toBe(false);
  });
});
