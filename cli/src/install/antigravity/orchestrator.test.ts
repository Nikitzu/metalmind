import { existsSync, mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installAntigravity, uninstallAntigravity } from './orchestrator.js';

describe('installAntigravity', () => {
  it('stamps ~/.gemini/AGENTS.md and copies the skills under ~/.gemini/config/skills', async () => {
    const geminiDir = mkdtempSync(join(tmpdir(), 'mm-agy-'));
    await writeFile(join(geminiDir, 'AGENTS.md'), '# mine\n\nkeep this\n', 'utf8');
    const result = await installAntigravity({ vaultPath: '/tmp/v', flavor: 'scadrial', geminiDir });
    const agents = await readFile(join(geminiDir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('keep this');
    expect(agents).toContain('<!-- metalmind:antigravity:agents:begin -->');
    expect(agents).toContain('metalmind tap copper');
    expect(result.skills).toContain('metalmind-recall');
    expect(existsSync(join(geminiDir, 'config', 'skills', 'metalmind-recall', 'SKILL.md'))).toBe(
      true,
    );
    expect(existsSync(join(geminiDir, 'config', 'skills', 'save', 'SKILL.md'))).toBe(true);

    const un = await uninstallAntigravity({ geminiDir });
    expect(un.agentsMd).toBe(true);
    expect(un.skills).toContain('metalmind-recall');
    const after = await readFile(join(geminiDir, 'AGENTS.md'), 'utf8');
    expect(after).toContain('keep this');
    expect(after).not.toContain('metalmind:antigravity');
    expect(existsSync(join(geminiDir, 'config', 'skills', 'metalmind-recall'))).toBe(false);
  });

  it('is idempotent: a second install leaves one block', async () => {
    const geminiDir = mkdtempSync(join(tmpdir(), 'mm-agy-'));
    await installAntigravity({ vaultPath: '/tmp/v', flavor: 'classic', geminiDir });
    await installAntigravity({ vaultPath: '/tmp/v', flavor: 'classic', geminiDir });
    const agents = await readFile(join(geminiDir, 'AGENTS.md'), 'utf8');
    expect(agents.split('metalmind:antigravity:agents:begin').length).toBe(2);
    expect(agents).toContain('metalmind recall');
  });
});
