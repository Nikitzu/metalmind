import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../util/exec.js';

const runCommand = vi.hoisted(() => vi.fn<() => Promise<CommandResult>>());

vi.mock('../util/exec.js', () => ({
  runCommand,
}));

function mockResult(partial: Partial<CommandResult>): CommandResult {
  return { stdout: '', stderr: '', ok: true, exitCode: 0, ...partial };
}

describe('prereqs', () => {
  beforeEach(() => {
    runCommand.mockReset();
  });

  it('checkClaudeCode passes when CLI returns 0', async () => {
    runCommand.mockResolvedValueOnce(mockResult({ stdout: '2.1.32 (Claude Code)' }));
    const { checkClaudeCode } = await import('./prereqs.js');
    const r = await checkClaudeCode();
    expect(r.ok).toBe(true);
    expect(r.remediation).toBeUndefined();
  });

  it('checkClaudeCode fails with remediation when CLI missing', async () => {
    runCommand.mockResolvedValueOnce(mockResult({ ok: false, stderr: 'command not found' }));
    const { checkClaudeCode } = await import('./prereqs.js');
    const r = await checkClaudeCode();
    expect(r.ok).toBe(false);
    expect(r.remediation).toContain('claude.ai/code');
  });

  it('checkDocker passes when daemon reachable', async () => {
    runCommand
      .mockResolvedValueOnce(mockResult({ stdout: 'Docker version 27.1.0' }))
      .mockResolvedValueOnce(mockResult({ stdout: 'Containers: 0' }));
    const { checkDocker } = await import('./prereqs.js');
    const r = await checkDocker();
    expect(r.ok).toBe(true);
  });

  it('checkDocker fails when daemon unreachable', async () => {
    runCommand
      .mockResolvedValueOnce(mockResult({ stdout: 'Docker version 27.1.0' }))
      .mockResolvedValueOnce(mockResult({ ok: false, stderr: 'Cannot connect to daemon' }));
    const { checkDocker } = await import('./prereqs.js');
    const r = await checkDocker();
    expect(r.ok).toBe(false);
    expect(r.remediation).toContain('Docker Desktop');
  });

  it('checkPython passes on 3.12', async () => {
    runCommand.mockResolvedValueOnce(mockResult({ stdout: 'Python 3.12.1' }));
    const { checkPython } = await import('./prereqs.js');
    const r = await checkPython();
    expect(r.ok).toBe(true);
  });

  it('checkPython fails on 3.9', async () => {
    runCommand.mockResolvedValueOnce(mockResult({ stdout: 'Python 3.9.6' }));
    const { checkPython } = await import('./prereqs.js');
    const r = await checkPython();
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('3.9.6');
  });

  it('checkPython passes on 4.0 (future major)', async () => {
    runCommand.mockResolvedValueOnce(mockResult({ stdout: 'Python 4.0.0' }));
    const { checkPython } = await import('./prereqs.js');
    const r = await checkPython();
    expect(r.ok).toBe(true);
  });

  it('checkPython fails on unparseable output', async () => {
    runCommand.mockResolvedValueOnce(mockResult({ stdout: 'banana' }));
    const { checkPython } = await import('./prereqs.js');
    const r = await checkPython();
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('unparseable');
  });

  it('detectPrereqs returns all 5 results', async () => {
    runCommand.mockResolvedValue(mockResult({ stdout: 'ok', ok: true }));
    const { detectPrereqs } = await import('./prereqs.js');
    const results = await detectPrereqs();
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.name)).toEqual([
      'Claude Code',
      'Docker',
      'Python 3.10+',
      'uv',
      'git',
    ]);
  });
});
