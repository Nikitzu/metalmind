import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../util/exec.js';

const runCommand = vi.hoisted(() => vi.fn<() => Promise<CommandResult>>());

vi.mock('../util/exec.js', () => ({ runCommand }));

function mockOk(stdout = 'ok'): CommandResult {
  return { stdout, stderr: '', ok: true, exitCode: 0 };
}

describe('stack', () => {
  let tmp: string;
  let templatesDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-stack-'));
    templatesDir = join(tmp, 'templates');
    const stackSrc = join(templatesDir, 'claude-stack');
    await mkdir(join(stackSrc, 'vault_rag'), { recursive: true });
    await writeFile(join(stackSrc, 'compose.yml'), 'services: {}\n', 'utf8');
    await writeFile(join(stackSrc, 'vault_rag', 'server.py'), '# vault_rag\n', 'utf8');
    runCommand.mockReset();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('copyStackTemplates copies compose.yml + vault_rag/', async () => {
    const { copyStackTemplates } = await import('./stack.js');
    const vaultPath = join(tmp, 'vault');
    const stackDir = await copyStackTemplates(vaultPath, templatesDir);

    expect(stackDir).toBe(join(vaultPath, '.claude-stack'));
    expect(existsSync(join(stackDir, 'compose.yml'))).toBe(true);
    expect(existsSync(join(stackDir, 'vault_rag', 'server.py'))).toBe(true);
  });

  it('setupStack in dryRun skips execa + polling', async () => {
    const { setupStack } = await import('./stack.js');
    const result = await setupStack({
      vaultPath: join(tmp, 'vault'),
      templatesDir,
      dryRun: true,
    });

    expect(result.started).toBe(false);
    expect(result.modelPulled).toBe(false);
    expect(result.actionsSkipped).toContain('docker compose up');
    expect(result.actionsSkipped).toContain('ollama pull');
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('setupStack happy path: start, poll both, pull model', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true } as Response);
    runCommand
      .mockResolvedValueOnce(mockOk()) // compose up
      .mockResolvedValueOnce(mockOk()); // ollama pull

    const { setupStack } = await import('./stack.js');
    const result = await setupStack({
      vaultPath: join(tmp, 'vault'),
      templatesDir,
      fetchFn,
      pollTimeoutMs: 2_000,
      pollIntervalMs: 10,
    });

    expect(result.started).toBe(true);
    expect(result.ollamaReady).toBe(true);
    expect(result.qdrantReady).toBe(true);
    expect(result.modelPulled).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenCalled();
  });

  it('setupStack fails when Ollama never comes up', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('connection refused'));
    runCommand.mockResolvedValueOnce(mockOk()); // compose up succeeds

    const { setupStack } = await import('./stack.js');
    await expect(
      setupStack({
        vaultPath: join(tmp, 'vault'),
        templatesDir,
        fetchFn,
        pollTimeoutMs: 50,
        pollIntervalMs: 10,
      }),
    ).rejects.toThrow(/Ollama not reachable/);
  });

  it('startStack surfaces docker compose errors', async () => {
    runCommand.mockResolvedValueOnce({
      stdout: '',
      stderr: 'network error',
      ok: false,
      exitCode: 1,
    });

    const { startStack } = await import('./stack.js');
    await expect(startStack('/does/not/matter')).rejects.toThrow(/docker compose up failed/);
  });
});
