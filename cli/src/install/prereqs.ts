import { runCommand } from '../util/exec.js';

export interface PrereqResult {
  name: string;
  ok: boolean;
  detail: string;
  remediation?: string;
}

const MIN_PYTHON_MAJOR = 3;
const MIN_PYTHON_MINOR = 11;

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

const PYTHON_CANDIDATES = ['python3', 'python3.13', 'python3.12', 'python3.11'];

function parsePythonVersion(stdout: string): { major: number; minor: number } | null {
  const match = stdout.match(/Python (\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function meetsMinimum(version: { major: number; minor: number }): boolean {
  return (
    version.major > MIN_PYTHON_MAJOR ||
    (version.major === MIN_PYTHON_MAJOR && version.minor >= MIN_PYTHON_MINOR)
  );
}

export async function checkPython(): Promise<PrereqResult> {
  let latestSeen: {
    cmd: string;
    stdout: string;
    version: { major: number; minor: number };
  } | null = null;

  for (const cmd of PYTHON_CANDIDATES) {
    const res = await runCommand(cmd, ['--version']);
    if (!res.ok) continue;
    const version = parsePythonVersion(res.stdout);
    if (!version) continue;
    if (meetsMinimum(version)) {
      return {
        name: 'Python 3.11+',
        ok: true,
        detail: `${res.stdout} (via \`${cmd}\`)`,
      };
    }
    if (
      !latestSeen ||
      version.major > latestSeen.version.major ||
      version.minor > latestSeen.version.minor
    ) {
      latestSeen = { cmd, stdout: res.stdout, version };
    }
  }

  if (latestSeen) {
    return {
      name: 'Python 3.11+',
      ok: false,
      detail: `found ${latestSeen.stdout} via \`${latestSeen.cmd}\` (need ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+)`,
      remediation:
        'Upgrade Python: `brew install python@3.12` — metalmind also probes python3.13 / python3.12 / python3.11 in case your PATH is pinned to an older python3.',
    };
  }

  return {
    name: 'Python 3.11+',
    ok: false,
    detail: 'no python3 variant found on PATH',
    remediation: 'Install Python: `brew install python@3.12`',
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
