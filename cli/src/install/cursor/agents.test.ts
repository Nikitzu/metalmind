import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyCursorAgents, removeCursorAgents } from './agents.js';

describe('copyCursorAgents', () => {
  it('copies all claude agent files into ~/.cursor/agents/', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const result = await copyCursorAgents({ cursorDir });
    expect(result.copied.length).toBeGreaterThanOrEqual(15);
    const files = readdirSync(join(cursorDir, 'agents'));
    expect(files).toContain('architect.md');
  });

  it('removeCursorAgents deletes the copied files', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    await copyCursorAgents({ cursorDir });
    const removed = await removeCursorAgents({ cursorDir });
    expect(removed.length).toBeGreaterThanOrEqual(15);
  });
});
