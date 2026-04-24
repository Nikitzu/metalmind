import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '@clack/prompts';
import { extractSentinelBlock } from '../util/sentinel.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function run(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    child.on('error', (err) => resolve({ stdout, stderr: String(err), code: 1 }));
  });
}

async function checkWorkingTree(cwd: string): Promise<CheckResult> {
  const { stdout } = await run('git', ['status', '--porcelain'], cwd);
  const clean = stdout.trim() === '';
  return {
    name: 'working tree clean',
    ok: clean,
    detail: clean
      ? 'no uncommitted changes'
      : `${stdout.trim().split('\n').length} uncommitted change(s)`,
  };
}

async function checkBranch(cwd: string): Promise<CheckResult> {
  const { stdout } = await run('git', ['branch', '--show-current'], cwd);
  const branch = stdout.trim();
  const ok = branch === 'main';
  return {
    name: 'on main branch',
    ok,
    detail: ok ? 'main' : `currently on '${branch}' — release from main`,
  };
}

async function checkVersionSync(repoRoot: string): Promise<CheckResult> {
  const pkgRaw = await readFile(join(repoRoot, 'cli', 'package.json'), 'utf8');
  const pkgVersion = (JSON.parse(pkgRaw) as { version: string }).version;
  const { stdout, code } = await run('metalmind', ['--version']);
  if (code !== 0) {
    return { name: 'global install matches HEAD', ok: false, detail: 'metalmind not on PATH' };
  }
  const globalVersion = stdout.trim();
  const ok = globalVersion === pkgVersion;
  return {
    name: 'global install matches HEAD',
    ok,
    detail: ok
      ? `both ${pkgVersion}`
      : `HEAD ${pkgVersion} · global ${globalVersion} — reinstall before tag`,
  };
}

async function checkTests(repoRoot: string): Promise<CheckResult> {
  const { code, stderr } = await run('pnpm', ['--filter', 'metalmind', 'test'], repoRoot);
  return {
    name: 'tests green',
    ok: code === 0,
    detail: code === 0 ? 'all suites pass' : `failure: ${stderr.split('\n').slice(-3).join(' ')}`,
  };
}

async function checkBuild(repoRoot: string): Promise<CheckResult> {
  const { code, stderr } = await run('pnpm', ['--filter', 'metalmind', 'build'], repoRoot);
  return {
    name: 'build ok',
    ok: code === 0,
    detail: code === 0 ? 'dist built' : `failure: ${stderr.split('\n').slice(-3).join(' ')}`,
  };
}

async function checkDoctor(): Promise<CheckResult> {
  const { code, stdout } = await run('metalmind', ['doctor']);
  const ok = code === 0 && /nominal|healthy/i.test(stdout);
  return {
    name: 'metalmind doctor clean',
    ok,
    detail: ok ? 'all systems nominal' : 'see `metalmind doctor` output',
  };
}

async function checkStampedBlockPresent(repoRoot: string): Promise<CheckResult> {
  try {
    const templatePath = join(repoRoot, 'cli', 'templates', 'claude', 'CLAUDE.md.block.template');
    const template = await readFile(templatePath, 'utf8');
    const stampedPath = join(homedir(), '.claude', 'CLAUDE.md');
    const stampedRaw = await readFile(stampedPath, 'utf8').catch(() => '');
    if (!stampedRaw) {
      return { name: 'stamped block present', ok: false, detail: '~/.claude/CLAUDE.md not found' };
    }
    const stamped = extractSentinelBlock(stampedRaw);
    if (!stamped) {
      return {
        name: 'stamped block present',
        ok: false,
        detail: 'no metalmind managed block — run `metalmind stamp`',
      };
    }
    const firstLine = template.split('\n').find((l) => l.trim().length > 0) ?? '';
    const signature = firstLine
      .replace(/\{\{[^}]+\}\}/g, '')
      .trim()
      .slice(0, 40);
    const ok = signature.length > 0 && stamped.includes(signature);
    return {
      name: 'stamped block matches template shape',
      ok,
      detail: ok
        ? 'signature line present'
        : 'block drifted from template — run `metalmind stamp` to refresh',
    };
  } catch (err) {
    return {
      name: 'stamped block present',
      ok: false,
      detail: `check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function releaseCheck(
  opts: { skipTests?: boolean; skipBuild?: boolean } = {},
): Promise<void> {
  const repoRoot = process.cwd();
  const checks: CheckResult[] = [];
  checks.push(await checkWorkingTree(repoRoot));
  checks.push(await checkBranch(repoRoot));
  checks.push(await checkVersionSync(repoRoot));
  if (!opts.skipBuild) checks.push(await checkBuild(repoRoot));
  if (!opts.skipTests) checks.push(await checkTests(repoRoot));
  checks.push(await checkDoctor());
  checks.push(await checkStampedBlockPresent(repoRoot));

  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  for (const c of checks) {
    const mark = c.ok ? '✓' : '✗';
    log[c.ok ? 'info' : 'error'](`${mark} ${c.name} — ${c.detail}`);
  }
  log.info(`${pass}/${checks.length} checks passed`);
  if (fail > 0) process.exitCode = 1;
}
