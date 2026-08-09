import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const RECALL_TOKEN_HEADER = 'X-Metalmind-Token';

export function recallTokenPath(): string {
  return process.env.METALMIND_RECALL_TOKEN_PATH ?? join(homedir(), '.metalmind', 'recall-token');
}

export async function recallAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = (await readFile(recallTokenPath(), 'utf8')).trim();
    return token ? { [RECALL_TOKEN_HEADER]: token } : {};
  } catch {
    return {};
  }
}
