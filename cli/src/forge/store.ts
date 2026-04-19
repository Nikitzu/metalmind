import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Config, readConfig, writeConfig } from '../config.js';

export const FORGE_CACHE_DIR = join(homedir(), '.metalmind', 'forge');

export interface ForgeGroup {
  repos: string[];
}

export interface ForgeStore {
  [name: string]: ForgeGroup;
}

async function requireConfig(): Promise<Config> {
  const config = await readConfig();
  if (!config) {
    throw new Error('No metalmind config. Run `metalmind init` first.');
  }
  return config;
}

async function withGroups(mutator: (groups: Record<string, ForgeGroup>) => void): Promise<Config> {
  const config = await requireConfig();
  mutator(config.forge.groups);
  await writeConfig(config);
  return config;
}

function cachePath(name: string): string {
  return join(FORGE_CACHE_DIR, `${name}.json`);
}

async function invalidateCache(name: string): Promise<void> {
  const p = cachePath(name);
  if (existsSync(p)) await unlink(p);
}

export async function createForge(name: string): Promise<void> {
  await withGroups((groups) => {
    if (groups[name]) {
      throw new Error(`forge group '${name}' already exists`);
    }
    groups[name] = { repos: [] };
  });
}

export async function deleteForge(name: string): Promise<void> {
  await withGroups((groups) => {
    if (!groups[name]) {
      throw new Error(`forge group '${name}' not found`);
    }
    delete groups[name];
  });
  await invalidateCache(name);
}

export async function addRepoToForge(name: string, repoPath: string): Promise<void> {
  const abs = repoPath.startsWith('/') ? repoPath : join(process.cwd(), repoPath);
  await withGroups((groups) => {
    const group = groups[name];
    if (!group) throw new Error(`forge group '${name}' not found`);
    if (group.repos.includes(abs)) {
      throw new Error(`repo already in forge '${name}'`);
    }
    group.repos.push(abs);
  });
  await invalidateCache(name);
}

export async function removeRepoFromForge(name: string, repoPath: string): Promise<void> {
  const abs = repoPath.startsWith('/') ? repoPath : join(process.cwd(), repoPath);
  await withGroups((groups) => {
    const group = groups[name];
    if (!group) throw new Error(`forge group '${name}' not found`);
    const index = group.repos.indexOf(abs);
    if (index === -1) {
      throw new Error(`repo not in forge '${name}'`);
    }
    group.repos.splice(index, 1);
  });
  await invalidateCache(name);
}

export async function listForges(): Promise<ForgeStore> {
  const config = await requireConfig();
  return config.forge.groups;
}

export async function getForge(name: string): Promise<ForgeGroup> {
  const config = await requireConfig();
  const group = config.forge.groups[name];
  if (!group) throw new Error(`forge group '${name}' not found`);
  return group;
}
