import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addCodexMcpServer,
  applyCodexHooksJson,
  applyCodexNetworkAccess,
  clearCodexAgentsMd,
  clearCodexHooksJson,
  clearCodexNetworkAccess,
  copyCodexHook,
  copyCodexPrefixRules,
  copyCodexSkills,
  removeCodexHookScript,
  removeCodexMcpServer,
  removeCodexPrefixRules,
  removeCodexSkills,
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
            PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '/usr/bin/audit' }] }],
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

describe('applyCodexNetworkAccess', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-net-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('creates config.toml with sentinel-bounded network block', async () => {
    const result = await applyCodexNetworkAccess({ templatesDir: TEMPLATES_DIR, codexDir });
    expect(result.blockAction).toBe('created');
    const content = await readFile(result.configTomlPath, 'utf8');
    expect(content).toContain('# metalmind:codex:network:begin');
    expect(content).toContain('# metalmind:codex:network:end');
    expect(content).toContain('[sandbox_workspace_write]');
    expect(content).toContain('network_access = true');
  });

  it('preserves user TOML outside the sentinels', async () => {
    const target = join(codexDir, 'config.toml');
    await mkdir(codexDir, { recursive: true });
    await writeFile(target, '[mcp_servers.user_thing]\nurl = "http://localhost:99"\n', 'utf8');
    await applyCodexNetworkAccess({ templatesDir: TEMPLATES_DIR, codexDir });
    const content = await readFile(target, 'utf8');
    expect(content).toContain('[mcp_servers.user_thing]');
    expect(content).toContain('url = "http://localhost:99"');
    expect(content).toContain('# metalmind:codex:network:begin');
  });

  it('is idempotent on second identical call', async () => {
    await applyCodexNetworkAccess({ templatesDir: TEMPLATES_DIR, codexDir });
    const second = await applyCodexNetworkAccess({ templatesDir: TEMPLATES_DIR, codexDir });
    expect(second.blockAction).toBe('unchanged');
  });
});

describe('clearCodexNetworkAccess', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-net-clear-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('returns false when config.toml absent', async () => {
    expect(await clearCodexNetworkAccess({ codexDir })).toBe(false);
  });

  it('strips block and preserves user TOML', async () => {
    const target = join(codexDir, 'config.toml');
    await mkdir(codexDir, { recursive: true });
    await writeFile(target, '[mcp_servers.user]\nurl = "http://x"\n', 'utf8');
    await applyCodexNetworkAccess({ templatesDir: TEMPLATES_DIR, codexDir });
    expect(await clearCodexNetworkAccess({ codexDir })).toBe(true);
    const content = await readFile(target, 'utf8');
    expect(content).toContain('[mcp_servers.user]');
    expect(content).not.toContain('metalmind:codex:network');
  });

  it('deletes config.toml when our block was the only content', async () => {
    await applyCodexNetworkAccess({ templatesDir: TEMPLATES_DIR, codexDir });
    expect(await clearCodexNetworkAccess({ codexDir })).toBe(true);
    expect(existsSync(join(codexDir, 'config.toml'))).toBe(false);
  });
});

describe('copyCodexPrefixRules', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-rules-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('writes ~/.codex/rules/metalmind.rules with prefix_rule entries', async () => {
    const result = await copyCodexPrefixRules({ templatesDir: TEMPLATES_DIR, codexDir });
    expect(result.action).toBe('created');
    expect(result.rulesPath).toBe(join(codexDir, 'rules', 'metalmind.rules'));
    const content = await readFile(result.rulesPath, 'utf8');
    expect(content).toContain('prefix_rule(["metalmind", "tap"], decision="allow")');
    expect(content).toContain('prefix_rule(["metalmind", "scribe"], decision="allow")');
    expect(content).toContain('prefix_rule(["metalmind", "recall"], decision="allow")');
  });

  it('NEVER touches default.rules', async () => {
    const rulesDir = join(codexDir, 'rules');
    await mkdir(rulesDir, { recursive: true });
    const defaultRulesPath = join(rulesDir, 'default.rules');
    const sentinel = '# Codex user-acceptance log\nprefix_rule(["other"], decision="allow")\n';
    await writeFile(defaultRulesPath, sentinel, 'utf8');
    await copyCodexPrefixRules({ templatesDir: TEMPLATES_DIR, codexDir });
    expect(await readFile(defaultRulesPath, 'utf8')).toBe(sentinel);
  });

  it('is idempotent on second identical call', async () => {
    await copyCodexPrefixRules({ templatesDir: TEMPLATES_DIR, codexDir });
    const second = await copyCodexPrefixRules({ templatesDir: TEMPLATES_DIR, codexDir });
    expect(second.action).toBe('unchanged');
  });

  it('reports updated when on-disk content drifted from template', async () => {
    await copyCodexPrefixRules({ templatesDir: TEMPLATES_DIR, codexDir });
    const rulesPath = join(codexDir, 'rules', 'metalmind.rules');
    await writeFile(rulesPath, '# tampered\n', 'utf8');
    const result = await copyCodexPrefixRules({ templatesDir: TEMPLATES_DIR, codexDir });
    expect(result.action).toBe('updated');
    const content = await readFile(rulesPath, 'utf8');
    expect(content).toContain('prefix_rule(["metalmind", "tap"]');
  });
});

describe('removeCodexPrefixRules', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-rules-rm-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('returns false when our file absent', async () => {
    expect(await removeCodexPrefixRules({ codexDir })).toBe(false);
  });

  it('removes metalmind.rules', async () => {
    await copyCodexPrefixRules({ templatesDir: TEMPLATES_DIR, codexDir });
    expect(await removeCodexPrefixRules({ codexDir })).toBe(true);
    expect(existsSync(join(codexDir, 'rules', 'metalmind.rules'))).toBe(false);
  });

  it('NEVER removes default.rules', async () => {
    const rulesDir = join(codexDir, 'rules');
    await mkdir(rulesDir, { recursive: true });
    const defaultRulesPath = join(rulesDir, 'default.rules');
    await writeFile(defaultRulesPath, '# user log\n', 'utf8');
    await copyCodexPrefixRules({ templatesDir: TEMPLATES_DIR, codexDir });
    await removeCodexPrefixRules({ codexDir });
    expect(existsSync(defaultRulesPath)).toBe(true);
  });
});

describe('copyCodexSkills', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-skills-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('copies writing-vault-notes, synod, and save skill bundles', async () => {
    const result = await copyCodexSkills({
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    expect(result.copied).toEqual(['writing-vault-notes', 'synod', 'save']);
    expect(existsSync(join(codexDir, 'skills', 'writing-vault-notes', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(codexDir, 'skills', 'synod', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(codexDir, 'skills', 'save', 'SKILL.md'))).toBe(true);
  });

  it('strips synod flavor sentinels per chosen flavor (no flavor leak on disk)', async () => {
    await copyCodexSkills({ flavor: 'classic', templatesDir: TEMPLATES_DIR, codexDir });
    const persona = await readFile(
      join(codexDir, 'skills', 'synod', 'personas', 'scientist.md'),
      'utf8',
    );
    // Classic flavor → "The Scientist" kept, "Sazed" stripped.
    expect(persona).toContain('The Scientist');
    expect(persona).not.toContain('Sazed');
    // Sentinel comments themselves are stripped by renderFlavorSentinels.
    expect(persona).not.toContain('metalmind:flavor-');
  });

  it('strips synod flavor sentinels for scadrial flavor', async () => {
    await copyCodexSkills({ flavor: 'scadrial', templatesDir: TEMPLATES_DIR, codexDir });
    const persona = await readFile(
      join(codexDir, 'skills', 'synod', 'personas', 'scientist.md'),
      'utf8',
    );
    expect(persona).toContain('Sazed');
    expect(persona).not.toContain('The Scientist');
    expect(persona).not.toContain('metalmind:flavor-');
  });

  it('save SKILL.md resolves the shared partial with full body', async () => {
    await copyCodexSkills({
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
      eodHook: true,
      notifications: true,
    });
    const save = await readFile(join(codexDir, 'skills', 'save', 'SKILL.md'), 'utf8');
    // Partial-include directive must be gone (resolved at render time).
    expect(save).not.toContain('{{> .shared/save-body.md}}');
    // Body markers from the partial are present.
    expect(save).toContain('## What to save');
    expect(save).toContain('## Where to save');
    expect(save).toContain('## How to save');
    // RECALL_CMD substituted (not the literal placeholder).
    expect(save).toContain('metalmind recall');
    expect(save).not.toContain('{{RECALL_CMD}}');
    // Codex's frontmatter intact (proves the wrapper survived).
    expect(save).toMatch(/^---\nname: save\n/);
  });

  it('save SKILL.md strips eod sentinel when eodHook=false', async () => {
    await copyCodexSkills({
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
      eodHook: false,
      notifications: true,
    });
    const save = await readFile(join(codexDir, 'skills', 'save', 'SKILL.md'), 'utf8');
    expect(save).not.toContain('## End-of-day hook');
    expect(save).not.toContain('metalmind:eod:');
  });

  it('save SKILL.md body equals CC save.md body (shared partial parity)', async () => {
    // Render both consumers and compare the body section (everything after
    // their respective frontmatter blocks). This proves the {{> .shared/...}}
    // partial is the single source of truth — no drift possible.
    await copyCodexSkills({
      flavor: 'classic',
      templatesDir: TEMPLATES_DIR,
      codexDir,
      eodHook: true,
      notifications: true,
    });
    const codexSave = await readFile(join(codexDir, 'skills', 'save', 'SKILL.md'), 'utf8');

    const claudeDir = await mkdtemp(join(tmpdir(), 'mm-cc-save-eq-'));
    const { copyClaudeTemplates } = await import('./templates.js');
    await copyClaudeTemplates({
      templatesDir: TEMPLATES_DIR,
      claudeDir,
      flavor: 'classic',
      eodHook: true,
      notifications: true,
    });
    const claudeSave = await readFile(join(claudeDir, 'commands', 'save.md'), 'utf8');

    const stripFrontmatter = (s: string) => s.replace(/^---[\s\S]*?---\n/, '');
    // CC save.md has a "## Arguments" tail past the partial; strip it for
    // the comparison so we're comparing only the shared body section.
    const claudeBody = stripFrontmatter(claudeSave).replace(/\n## Arguments[\s\S]*$/, '\n');
    const codexBody = stripFrontmatter(codexSave);
    expect(codexBody).toBe(claudeBody);

    await rm(claudeDir, { recursive: true, force: true });
  });

  it('does NOT copy using-teams (CC-specific)', async () => {
    await copyCodexSkills({ flavor: 'classic', templatesDir: TEMPLATES_DIR, codexDir });
    expect(existsSync(join(codexDir, 'skills', 'using-teams'))).toBe(false);
  });

  it('renders {{RECALL_CMD}} per flavor in skill SKILL.md', async () => {
    await copyCodexSkills({ flavor: 'scadrial', templatesDir: TEMPLATES_DIR, codexDir });
    const content = await readFile(
      join(codexDir, 'skills', 'writing-vault-notes', 'SKILL.md'),
      'utf8',
    );
    expect(content).toContain('metalmind tap copper');
  });

  it('preserves user-added skills in ~/.codex/skills/', async () => {
    const userSkillDir = join(codexDir, 'skills', 'my-custom');
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(
      join(userSkillDir, 'SKILL.md'),
      '---\nname: my-custom\n---\n# my skill\n',
      'utf8',
    );
    await copyCodexSkills({ flavor: 'classic', templatesDir: TEMPLATES_DIR, codexDir });
    const content = await readFile(join(userSkillDir, 'SKILL.md'), 'utf8');
    expect(content).toContain('my-custom');
  });
});

describe('removeCodexSkills', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-skills-rm-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('returns [] when skills dir absent', async () => {
    expect(await removeCodexSkills({ codexDir })).toEqual([]);
  });

  it('removes our skills; preserves user skills', async () => {
    const userSkillDir = join(codexDir, 'skills', 'my-custom');
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(join(userSkillDir, 'SKILL.md'), '---\nname: my-custom\n---\n', 'utf8');
    await copyCodexSkills({ flavor: 'classic', templatesDir: TEMPLATES_DIR, codexDir });
    const removed = await removeCodexSkills({ codexDir });
    expect(removed.sort()).toEqual(['save', 'synod', 'writing-vault-notes']);
    expect(existsSync(join(codexDir, 'skills', 'writing-vault-notes'))).toBe(false);
    expect(existsSync(join(codexDir, 'skills', 'synod'))).toBe(false);
    expect(existsSync(join(codexDir, 'skills', 'save'))).toBe(false);
    expect(existsSync(userSkillDir)).toBe(true);
  });
});

// Fake codex binary for MCP-wrapper tests. Returns canned `mcp list --json`
// payloads so we can exercise the idempotency, replace-stale, and not-found
// paths without depending on a real codex install.
async function makeFakeCodex(behavior: {
  listOutput: string;
  listExitCode: 0 | 1;
  /** When true, mcp add/remove fail; lets us test error propagation. */
  addRemoveFail?: boolean;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mm-fake-codex-'));
  const script = join(dir, 'codex');
  const failExit = behavior.addRemoveFail ? '1' : '0';
  // Use a here-doc literal; bash 3 (macOS default) handles this fine.
  const body = `#!/bin/bash
sub="$1"; verb="$2"
if [ "$sub" = "mcp" ] && [ "$verb" = "list" ]; then
  if [ "$3" = "--json" ]; then
    cat <<'JSON'
${behavior.listOutput}
JSON
    exit ${behavior.listExitCode}
  fi
fi
if [ "$sub" = "mcp" ] && { [ "$verb" = "add" ] || [ "$verb" = "remove" ]; }; then
  exit ${failExit}
fi
exit 0
`;
  await writeFile(script, body, 'utf8');
  await chmod(script, 0o755);
  return script;
}

describe('addCodexMcpServer', () => {
  it('returns codex-not-found when `codex mcp list` fails (binary missing or broken)', async () => {
    const codexBin = await makeFakeCodex({ listOutput: '', listExitCode: 1 });
    const result = await addCodexMcpServer({ codexBin });
    expect(result.action).toBe('codex-not-found');
  });

  it('returns already-present when entry matches name+url', async () => {
    const codexBin = await makeFakeCodex({
      listOutput: '[{"name":"metalmind","url":"http://127.0.0.1:17317/mcp"}]',
      listExitCode: 0,
    });
    const result = await addCodexMcpServer({ codexBin });
    expect(result.action).toBe('already-present');
  });

  it('returns added when no entry exists', async () => {
    const codexBin = await makeFakeCodex({ listOutput: '[]', listExitCode: 0 });
    const result = await addCodexMcpServer({ codexBin });
    expect(result.action).toBe('added');
    expect(result.url).toBe('http://127.0.0.1:17317/mcp');
  });

  it('replaces stale entry pointing at a different url', async () => {
    const codexBin = await makeFakeCodex({
      listOutput: '[{"name":"metalmind","url":"http://stale:9999/mcp"}]',
      listExitCode: 0,
    });
    const result = await addCodexMcpServer({ codexBin });
    expect(result.action).toBe('added');
  });

  it('throws when `codex mcp add` fails', async () => {
    const codexBin = await makeFakeCodex({
      listOutput: '[]',
      listExitCode: 0,
      addRemoveFail: true,
    });
    await expect(addCodexMcpServer({ codexBin })).rejects.toThrow(/codex mcp add failed/);
  });
});

describe('removeCodexMcpServer', () => {
  it('returns codex-not-found when `codex mcp list` fails', async () => {
    const codexBin = await makeFakeCodex({ listOutput: '', listExitCode: 1 });
    const result = await removeCodexMcpServer({ codexBin });
    expect(result.action).toBe('codex-not-found');
  });

  it('returns absent when entry not registered', async () => {
    const codexBin = await makeFakeCodex({
      listOutput: '[{"name":"other","url":"http://example/x"}]',
      listExitCode: 0,
    });
    const result = await removeCodexMcpServer({ codexBin });
    expect(result.action).toBe('absent');
  });

  it('returns removed when entry was registered', async () => {
    const codexBin = await makeFakeCodex({
      listOutput: '[{"name":"metalmind","url":"http://127.0.0.1:17317/mcp"}]',
      listExitCode: 0,
    });
    const result = await removeCodexMcpServer({ codexBin });
    expect(result.action).toBe('removed');
  });
});
