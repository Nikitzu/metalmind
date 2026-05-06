import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkCodexInstall } from '../commands/doctor.js';
import { installCodex, uninstallCodex } from './codex.js';

// End-to-end smoke: install all Phase 1+2 primitives via the orchestrator
// → assert doctor goes all-green → uninstall → assert doctor goes all-fail
// → assert ~/.codex/ has zero metalmind residue (excluding default.rules,
// which Codex manages and we never touch).

const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

describe('codex install end-to-end smoke', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await mkdtemp(join(tmpdir(), 'mm-codex-e2e-'));
  });

  afterEach(async () => {
    await rm(codexDir, { recursive: true, force: true });
  });

  it('installCodex → checkCodexInstall green → uninstallCodex → checkCodexInstall red', async () => {
    // Pre-seed default.rules with user-acceptance content; we must never touch it.
    await mkdir(join(codexDir, 'rules'), { recursive: true });
    const defaultRulesContent = '# Codex user-acceptance log\nprefix_rule(["other"], decision="allow")\n';
    const { writeFile } = await import('node:fs/promises');
    const defaultRulesPath = join(codexDir, 'rules', 'default.rules');
    await writeFile(defaultRulesPath, defaultRulesContent, 'utf8');

    // INSTALL.
    const installResult = await installCodex({
      vaultPath: '/Users/test/Knowledge',
      flavor: 'classic',
      eodHook: true,
      notifications: true,
      withMcp: false,
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    expect(installResult.agentsMd).toBe('created');
    expect(installResult.hookScript).toBe('created');
    expect(installResult.hooksJson).toBe('changed');
    expect(installResult.networkAccess).toBe('created');
    expect(installResult.prefixRules).toBe('created');
    expect(installResult.skills.sort()).toEqual(['save', 'synod', 'writing-vault-notes']);
    expect(installResult.mcp).toBe('skipped');

    // DOCTOR — every check green (mcp skipped because we didn't pass checkMcp).
    const doctorAfterInstall = await checkCodexInstall({ codexDir });
    for (const check of doctorAfterInstall) {
      expect(check.ok, `${check.name} expected ok, got: ${check.detail}`).toBe(true);
    }

    // UNINSTALL — removeMcp:false so the smoke doesn't depend on a codex binary.
    const uninstallResult = await uninstallCodex({ codexDir, removeMcp: false });
    expect(uninstallResult.agentsMd).toBe(true);
    expect(uninstallResult.hooksJson).toBe(true);
    expect(uninstallResult.hookScript).toBe(true);
    expect(uninstallResult.networkAccess).toBe(true);
    expect(uninstallResult.prefixRules).toBe(true);
    expect(uninstallResult.skills.sort()).toEqual(['save', 'synod', 'writing-vault-notes']);

    // DOCTOR — every check red.
    const doctorAfterUninstall = await checkCodexInstall({ codexDir });
    for (const check of doctorAfterUninstall) {
      expect(check.ok, `${check.name} expected fail, got: ${check.detail}`).toBe(false);
    }

    // RESIDUE — every metalmind artifact gone.
    expect(existsSync(join(codexDir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(codexDir, 'hooks.json'))).toBe(false);
    expect(existsSync(join(codexDir, 'hooks', 'metalmind-session-start.sh'))).toBe(false);
    expect(existsSync(join(codexDir, 'rules', 'metalmind.rules'))).toBe(false);
    expect(existsSync(join(codexDir, 'skills', 'writing-vault-notes'))).toBe(false);
    expect(existsSync(join(codexDir, 'skills', 'synod'))).toBe(false);
    expect(existsSync(join(codexDir, 'skills', 'save'))).toBe(false);
    // config.toml may exist if we left an empty file, but our sentinel block must be gone.
    if (existsSync(join(codexDir, 'config.toml'))) {
      const toml = await readFile(join(codexDir, 'config.toml'), 'utf8');
      expect(toml).not.toContain('metalmind:codex:network');
    }

    // CRITICAL boundary: default.rules untouched.
    expect(existsSync(defaultRulesPath)).toBe(true);
    expect(await readFile(defaultRulesPath, 'utf8')).toBe(defaultRulesContent);
  });

  it('install is idempotent — second installCodex returns unchanged actions', async () => {
    await installCodex({
      vaultPath: '/x',
      flavor: 'classic',
      eodHook: true,
      notifications: true,
      withMcp: false,
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    const second = await installCodex({
      vaultPath: '/x',
      flavor: 'classic',
      eodHook: true,
      notifications: true,
      withMcp: false,
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });
    expect(second.agentsMd).toBe('unchanged');
    expect(second.hookScript).toBe('unchanged');
    expect(second.hooksJson).toBe('unchanged');
    expect(second.networkAccess).toBe('unchanged');
    expect(second.prefixRules).toBe('unchanged');
    expect(second.skills).toHaveLength(3);
  });

  it('install preserves user content alongside ours', async () => {
    // Pre-seed user content in AGENTS.md and config.toml.
    await mkdir(codexDir, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    const userAgents = '# My personal AGENTS.md\nUser instructions.\n';
    const userToml =
      '[mcp_servers.user_thing]\nurl = "http://localhost:99"\ncommand = "user-binary"\n';
    await writeFile(join(codexDir, 'AGENTS.md'), userAgents, 'utf8');
    await writeFile(join(codexDir, 'config.toml'), userToml, 'utf8');

    await installCodex({
      vaultPath: '/x',
      flavor: 'classic',
      eodHook: true,
      notifications: true,
      withMcp: false,
      templatesDir: TEMPLATES_DIR,
      codexDir,
    });

    const agentsAfter = await readFile(join(codexDir, 'AGENTS.md'), 'utf8');
    expect(agentsAfter).toContain('# My personal AGENTS.md');
    expect(agentsAfter).toContain('User instructions.');
    expect(agentsAfter).toContain('<!-- metalmind:codex:agents:begin -->');

    const tomlAfter = await readFile(join(codexDir, 'config.toml'), 'utf8');
    expect(tomlAfter).toContain('[mcp_servers.user_thing]');
    expect(tomlAfter).toContain('url = "http://localhost:99"');
    expect(tomlAfter).toContain('# metalmind:codex:network:begin');

    // Uninstall must preserve user content too.
    await uninstallCodex({ codexDir, removeMcp: false });
    const agentsFinal = existsSync(join(codexDir, 'AGENTS.md'))
      ? await readFile(join(codexDir, 'AGENTS.md'), 'utf8')
      : '';
    expect(agentsFinal).toContain('# My personal AGENTS.md');
    expect(agentsFinal).not.toContain('metalmind:codex:agents');

    const tomlFinal = existsSync(join(codexDir, 'config.toml'))
      ? await readFile(join(codexDir, 'config.toml'), 'utf8')
      : '';
    expect(tomlFinal).toContain('[mcp_servers.user_thing]');
    expect(tomlFinal).not.toContain('metalmind:codex:network');
  });
});
