import { log } from '@clack/prompts';
import {
  addRepoToForge,
  createForge,
  deleteForge,
  listForges,
  removeRepoFromForge,
} from '../forge/store.js';

function fail(message: string): void {
  log.error(message);
  process.exitCode = 1;
}

export async function forgeCreate(name: string): Promise<void> {
  try {
    await createForge(name);
    log.success(`forge '${name}' created`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function forgeAdd(name: string, repoPath: string): Promise<void> {
  try {
    await addRepoToForge(name, repoPath);
    log.success(`added ${repoPath} to forge '${name}'`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function forgeRemove(name: string, repoPath: string): Promise<void> {
  try {
    await removeRepoFromForge(name, repoPath);
    log.success(`removed ${repoPath} from forge '${name}'`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function forgeDelete(name: string): Promise<void> {
  try {
    await deleteForge(name);
    log.success(`forge '${name}' deleted`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function forgeList(): Promise<void> {
  try {
    const groups = await listForges();
    const names = Object.keys(groups);
    if (names.length === 0) {
      log.info('No forges defined. Create one with `metalmind forge create <name>`.');
      return;
    }
    for (const name of names) {
      const repos = groups[name]?.repos ?? [];
      log.info(`${name} (${repos.length} repo${repos.length === 1 ? '' : 's'})`);
      for (const r of repos) log.info(`  - ${r}`);
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
