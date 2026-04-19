import { runCommand } from '../util/exec.js';

export interface PrereqResult {
  name: string;
  ok: boolean;
  detail: string;
  remediation?: string;
}

const MIN_PYTHON_MAJOR = 3;
const MIN_PYTHON_MINOR = 10;

export async function checkClaudeCode(): Promise<PrereqResult> {
  const { ok, stdout, stderr } = await runCommand('claude', ['--version']);
  return ok
    ? { name: 'Claude Code', ok: true, detail: stdout || 'detected' }
    : {
        name: 'Claude Code',
        ok: false,
        detail: stderr || 'not found on PATH',
        remediation: 'Install from https://claude.ai/code',
      };
}

export async function checkDocker(): Promise<PrereqResult> {
  const version = await runCommand('docker', ['--version']);
  if (!version.ok) {
    return {
      name: 'Docker',
      ok: false,
      detail: 'docker CLI not found',
      remediation: 'Install Docker Desktop: https://www.docker.com/products/docker-desktop',
    };
  }
  const info = await runCommand('docker', ['info'], { timeoutMs: 8000 });
  return info.ok
    ? { name: 'Docker', ok: true, detail: `daemon reachable (${version.stdout})` }
    : {
        name: 'Docker',
        ok: false,
        detail: 'daemon unreachable',
        remediation: 'Open Docker Desktop and wait for it to finish starting',
      };
}

export async function checkPython(): Promise<PrereqResult> {
  const { ok, stdout, stderr } = await runCommand('python3', ['--version']);
  if (!ok) {
    return {
      name: 'Python 3.10+',
      ok: false,
      detail: stderr || 'python3 not found',
      remediation: 'Install Python: `brew install python@3.12`',
    };
  }
  const match = stdout.match(/Python (\d+)\.(\d+)/);
  if (!match) {
    return {
      name: 'Python 3.10+',
      ok: false,
      detail: `unparseable version: ${stdout}`,
      remediation: 'Ensure `python3 --version` returns "Python X.Y.Z"',
    };
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const meets =
    major > MIN_PYTHON_MAJOR || (major === MIN_PYTHON_MAJOR && minor >= MIN_PYTHON_MINOR);
  return meets
    ? { name: 'Python 3.10+', ok: true, detail: stdout }
    : {
        name: 'Python 3.10+',
        ok: false,
        detail: `found ${stdout} (need ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+)`,
        remediation: 'Upgrade Python: `brew install python@3.12`',
      };
}

export async function checkUv(): Promise<PrereqResult> {
  const { ok, stdout, stderr } = await runCommand('uv', ['--version']);
  return ok
    ? { name: 'uv', ok: true, detail: stdout }
    : {
        name: 'uv',
        ok: false,
        detail: stderr || 'uv not found on PATH',
        remediation: 'Install: `curl -LsSf https://astral.sh/uv/install.sh | sh`',
      };
}

export async function checkGit(): Promise<PrereqResult> {
  const { ok, stdout, stderr } = await runCommand('git', ['--version']);
  return ok
    ? { name: 'git', ok: true, detail: stdout }
    : {
        name: 'git',
        ok: false,
        detail: stderr || 'git not found',
        remediation: 'Install: `brew install git` or Xcode Command Line Tools',
      };
}

export async function detectPrereqs(): Promise<PrereqResult[]> {
  return Promise.all([checkClaudeCode(), checkDocker(), checkPython(), checkUv(), checkGit()]);
}
