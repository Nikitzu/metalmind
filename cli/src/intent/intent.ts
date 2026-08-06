import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ForgeGroups } from '../coderefs/coderefs.js';
import { runCommand } from '../util/exec.js';

export interface IntentPackage {
  name: string;
  version: string | null;
  skillCount: number;
}

export interface RepoIntentSkills {
  repo: string;
  status: 'ok' | 'unavailable';
  packages: IntentPackage[];
  skillCount: number;
}

export interface ForgeIntentScan {
  repos: RepoIntentSkills[];
}

const PER_REPO_TIMEOUT_MS = 2000;
const TOTAL_TIMEOUT_MS = 10_000;

function intentBinPath(repoPath: string): string {
  return join(repoPath, 'node_modules', '.bin', 'intent');
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function extractPackages(parsed: unknown): IntentPackage[] {
  const raw = (parsed as Record<string, unknown>)?.packages;
  if (!Array.isArray(raw)) return [];
  const out: IntentPackage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const name = asString(rec.name);
    if (!name) continue;
    out.push({
      name,
      version: asString(rec.version),
      skillCount: typeof rec.skillCount === 'number' ? rec.skillCount : 0,
    });
  }
  return out;
}

function extractSkillCount(parsed: unknown, packages: IntentPackage[]): number {
  const skills = (parsed as Record<string, unknown>)?.skills;
  if (Array.isArray(skills)) return skills.length;
  return packages.reduce((n, p) => n + p.skillCount, 0);
}

export async function listIntentSkills(
  repoPath: string,
  opts: { timeoutMs?: number } = {},
): Promise<RepoIntentSkills> {
  const unavailable: RepoIntentSkills = {
    repo: repoPath,
    status: 'unavailable',
    packages: [],
    skillCount: 0,
  };
  const bin = intentBinPath(repoPath);
  if (!existsSync(bin)) return unavailable;

  const res = await runCommand(bin, ['list', '--json'], {
    timeoutMs: opts.timeoutMs ?? PER_REPO_TIMEOUT_MS,
    cwd: repoPath,
  });
  if (!res.ok) return unavailable;

  try {
    const parsed: unknown = JSON.parse(res.stdout);
    const packages = extractPackages(parsed);
    return {
      repo: repoPath,
      status: 'ok',
      packages,
      skillCount: extractSkillCount(parsed, packages),
    };
  } catch {
    return unavailable;
  }
}

export async function scanForgeIntentSkills(
  groups: ForgeGroups,
  opts: { deadline?: number } = {},
): Promise<ForgeIntentScan> {
  const deadline = opts.deadline ?? Date.now() + TOTAL_TIMEOUT_MS;
  const seen = new Set<string>();
  const repos: RepoIntentSkills[] = [];
  for (const name of Object.keys(groups).sort()) {
    for (const repo of groups[name]?.repos ?? []) {
      if (seen.has(repo)) continue;
      seen.add(repo);
      if (!existsSync(repo)) continue;
      if (Date.now() > deadline) return { repos };
      repos.push(await listIntentSkills(repo));
    }
  }
  return { repos };
}
