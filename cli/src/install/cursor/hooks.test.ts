import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCursorHooksJson, clearCursorHooksJson, copyCursorHook } from './hooks.js';

describe('cursor hooks', () => {
  it('copyCursorHook renders RECALL_CMD and emits snake_case additional_context', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const result = await copyCursorHook({ cursorDir, flavor: 'scadrial' });
    const script = readFileSync(result.hookScriptPath, 'utf8');
    expect(script).toContain('"additional_context"');
    expect(script).toContain('metalmind tap copper');
    expect(script).not.toContain('{{RECALL_CMD}}');
  });

  it('applyCursorHooksJson merges without clobbering existing hooks', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const hooksJsonPath = join(cursorDir, 'hooks.json');
    writeFileSync(
      hooksJsonPath,
      JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: 'user-hook.sh' }] } }),
    );
    await applyCursorHooksJson({
      hooksJsonPath,
      hookCommand: 'bash /x/metalmind-cursor-session-start.sh',
    });
    const data = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
    expect(data.version).toBe(1);
    expect(data.hooks.sessionStart).toHaveLength(2);
    expect(data.hooks.sessionStart.map((h: { command: string }) => h.command)).toContain(
      'user-hook.sh',
    );
  });

  it('applyCursorHooksJson is idempotent', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const hooksJsonPath = join(cursorDir, 'hooks.json');
    await applyCursorHooksJson({
      hooksJsonPath,
      hookCommand: 'bash /x/metalmind-cursor-session-start.sh',
    });
    const second = await applyCursorHooksJson({
      hooksJsonPath,
      hookCommand: 'bash /x/metalmind-cursor-session-start.sh',
    });
    expect(second.changed).toBe(false);
  });

  it('clearCursorHooksJson removes only the metalmind entry', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const hooksJsonPath = join(cursorDir, 'hooks.json');
    writeFileSync(
      hooksJsonPath,
      JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: 'user-hook.sh' }] } }),
    );
    await applyCursorHooksJson({
      hooksJsonPath,
      hookCommand: 'bash /x/metalmind-cursor-session-start.sh',
    });
    await clearCursorHooksJson({ hooksJsonPath });
    const data = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
    expect(data.hooks.sessionStart).toEqual([{ command: 'user-hook.sh' }]);
  });
});
