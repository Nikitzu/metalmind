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

  it('checkPython passes on 3.12 via python3', async () => {
    runCommand.mockResolvedValueOnce(mockResult({ stdout: 'Python 3.12.1' }));
    const { checkPython } = await import('./prereqs.js');
    const r = await checkPython();
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('python3');
  });

  it('checkPython falls back to python3.12 when python3 is too old', async () => {
    runCommand
      .mockResolvedValueOnce(mockResult({ stdout: 'Python 3.10.6' })) // python3 - too old (3.10 now rejected)
      .mockResolvedValueOnce(mockResult({ ok: false })) // python3.13 - missing
      .mockResolvedValueOnce(mockResult({ stdout: 'Python 3.12.13' })); // python3.12 - accepted
    const { checkPython } = await import('./prereqs.js');
    const r = await checkPython();
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('3.12.13');
    expect(r.detail).toContain('python3.12');
  });

  it('checkPython fails when every candidate is <3.11, reporting the newest seen', async () => {
    runCommand.mockResolvedValue(mockResult({ ok: false })); // all four candidates fail by default
    runCommand.mockResolvedValueOnce(mockResult({ stdout: 'Python 3.10.6' })); // python3
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

  it('detectPrereqs returns the embedded-backend check set by default', async () => {
    runCommand.mockResolvedValue(mockResult({ stdout: 'ok', ok: true }));
    const { detectPrereqs } = await import('./prereqs.js');
    const results = await detectPrereqs();
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.name)).toEqual(['Claude Code', 'Python 3.11+', 'uv', 'git']);
  });
});
