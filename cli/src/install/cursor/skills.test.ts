import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyCursorSkills, removeCursorSkills } from './skills.js';

describe('copyCursorSkills', () => {
  it('copies metalmind-recall with RECALL_CMD substituted', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const result = await copyCursorSkills({ cursorDir, flavor: 'scadrial' });
    expect(result.copied).toContain('metalmind-recall');
    const skill = readFileSync(
      join(cursorDir, 'skills', 'metalmind-recall', 'SKILL.md'),
      'utf8',
    );
    expect(skill).toContain('metalmind tap copper');
    expect(skill).not.toContain('{{RECALL_CMD}}');
  });

  it('removeCursorSkills deletes only metalmind skills', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    await copyCursorSkills({ cursorDir, flavor: 'scadrial' });
    const removed = await removeCursorSkills({ cursorDir });
    expect(removed).toContain('metalmind-recall');
  });
});
