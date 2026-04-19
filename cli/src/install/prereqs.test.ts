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

  it('checkPython passes on 3.12 via python3', async () => {
    runCommand.mockResolvedValueOnce(mockResult({ stdout: 'Python 3.12.1' }));
    const { checkPython } = await import('./prereqs.js');
    const r = await checkPython();
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('python3');
  });

  it('checkPython falls back to python3.12 when python3 is too old', async () => {
    runCommand
      .mockResolvedValueOnce(mockResult({ stdout: 'Python 3.9.6' })) // python3 — old
      .mockResolvedValueOnce(mockResult({ ok: false })) // python3.13 — missing
      .mockResolvedValueOnce(mockResult({ stdout: 'Python 3.12.13' })); // python3.12 — accepted
    const { checkPython } = await import('./prereqs.js');
    const r = await checkPython();
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('3.12.13');
    expect(r.detail).toContain('python3.12');
  });

  it('checkPython fails when every candidate is <3.10, reporting the newest seen', async () => {
    runCommand.mockResolvedValue(mockResult({ ok: false })); // all five candidates fail by default
    runCommand.mockResolvedValueOnce(mockResult({ stdout: 'Python 3.9.6' })); // python3
    runCommand.mockResolvedValueOnce(mockResult({ stdout: 'Python 3.8.0' })); // python3.13 (fake old)
    const { checkPython } = await import('./prereqs.js');
    const r = await checkPython();
    expect(r.ok).toBe(false);
    expect(r.remediation).toContain('brew install python@3.12');
  });

  it('checkPython fails with a clean message when no python is found at all', async () => {
    runCommand.mockResolvedValue(mockResult({ ok: false, stderr: 'command not found' }));
    const { checkPython } = await import('./prereqs.js');
    const r = await checkPython();
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('no python3 variant');
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
