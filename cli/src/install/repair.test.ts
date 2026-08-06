import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPendingRepairs } from './repair.js';
import { clearGraphifyHooks, findGraphifyHooks } from './settings.js';

const GRAPHIFY_HOOK_COMMAND =
  '[ -f graphify-out/graph.json ] && echo \'{"hookSpecificOutput":{"additionalContext":"graphify: read the graph"}}\' || true';

describe('graphify hooks in settings.json', () => {
  let dir: string;
  let settings: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mm-hooks-'));
    settings = join(dir, 'settings.json');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds the graphify PreToolUse hook that graphify claude uninstall never removes', async () => {
    await writeFile(
      settings,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Glob|Grep', hooks: [{ type: 'command', command: GRAPHIFY_HOOK_COMMAND }] },
          ],
        },
      }),
      'utf8',
    );
    expect(await findGraphifyHooks(settings)).toEqual(['PreToolUse:Glob|Grep']);
  });

  it('removes only the graphify entry and leaves unrelated hooks intact', async () => {
    await writeFile(
      settings,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Glob|Grep', hooks: [{ type: 'command', command: GRAPHIFY_HOOK_COMMAND }] },
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'bash edit-loop-breaker.sh' }] },
          ],
          TaskCompleted: [{ hooks: [{ type: 'command', command: 'bash warn.sh' }] }],
        },
      }),
      'utf8',
    );

    expect(await clearGraphifyHooks(settings)).toBe(true);

    const data = JSON.parse(await readFile(settings, 'utf8'));
    expect(data.hooks.PreToolUse).toHaveLength(1);
    expect(data.hooks.PreToolUse[0].matcher).toBe('Edit');
    expect(data.hooks.TaskCompleted).toHaveLength(1);
    expect(await findGraphifyHooks(settings)).toEqual([]);
  });

  it('drops the event key entirely when graphify was its only hook', async () => {
    await writeFile(
      settings,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Glob|Grep', hooks: [{ type: 'command', command: GRAPHIFY_HOOK_COMMAND }] },
          ],
        },
      }),
      'utf8',
    );
    await clearGraphifyHooks(settings);
    const data = JSON.parse(await readFile(settings, 'utf8'));
    expect(data.hooks).toBeUndefined();
  });

  it('is a no-op when there is nothing to remove', async () => {
    await writeFile(settings, JSON.stringify({ hooks: {} }), 'utf8');
    expect(await clearGraphifyHooks(settings)).toBe(false);
  });
});

describe('runPendingRepairs', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mm-repair-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs a repair once and never again, so upgrades self-heal without re-running init', async () => {
    let runs = 0;
    const repairs = [
      {
        name: 'demo',
        run: async () => {
          runs++;
          return 'did the thing';
        },
      },
    ];

    const first = await runPendingRepairs({ stateDir: dir, repairs });
    expect(first).toEqual([{ name: 'demo', applied: true, detail: 'did the thing' }]);
    expect(existsSync(join(dir, 'demo'))).toBe(true);

    const second = await runPendingRepairs({ stateDir: dir, repairs });
    expect(second).toEqual([]);
    expect(runs).toBe(1);
  });

  it('marks a no-op repair done so it stops costing anything', async () => {
    const repairs = [{ name: 'quiet', run: async () => null }];
    const res = await runPendingRepairs({ stateDir: dir, repairs });
    expect(res).toEqual([{ name: 'quiet', applied: false, detail: undefined }]);
    expect(existsSync(join(dir, 'quiet'))).toBe(true);
  });

  it('a throwing repair is not marked done, so it retries next run', async () => {
    const repairs = [
      {
        name: 'boom',
        run: async () => {
          throw new Error('nope');
        },
      },
    ];
    const res = await runPendingRepairs({ stateDir: dir, repairs });
    expect(res).toEqual([]);
    expect(existsSync(join(dir, 'boom'))).toBe(false);
  });
});
