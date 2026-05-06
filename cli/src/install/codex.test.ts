import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCodexAgentsMd, stampCodexAgentsMd } from './codex.js';

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
