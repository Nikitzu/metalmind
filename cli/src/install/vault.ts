import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { text } from '@clack/prompts';
import { expandTilde, getTemplatesDir } from '../util/paths.js';
import { type SentinelUpsertAction, upsertSentinelBlock } from '../util/sentinel.js';
import { recallCommand } from './templates.js';

export const VAULT_FOLDERS = [
  'Work',
  'Personal',
  'Learnings',
  'Daily',
  'Inbox',
  'Archive',
  'Memory',
] as const;

export interface SetupVaultResult {
  vaultPath: string;
  createdFolders: string[];
  claudeMdAction: SentinelUpsertAction;
}

export interface SetupVaultOptions {
  vaultPath: string;
  flavor: 'scadrial' | 'classic';
  templatesDir?: string;
}

export async function promptVaultPath(defaultPath = '~/Knowledge'): Promise<string> {
  const answer = await text({
    message: 'Obsidian vault path',
    placeholder: defaultPath,
    initialValue: defaultPath,
    validate: (value) => {
      if (!value.trim()) return 'Path cannot be empty';
      return undefined;
    },
  });
  if (typeof answer !== 'string') {
    throw new Error('Vault path prompt cancelled');
  }
  return expandTilde(answer.trim());
}

export async function setupVault(opts: SetupVaultOptions): Promise<SetupVaultResult> {
  const vaultPath = expandTilde(opts.vaultPath);
  const templatesDir = opts.templatesDir ?? getTemplatesDir();

  const createdFolders: string[] = [];
  for (const folder of VAULT_FOLDERS) {
    const target = join(vaultPath, folder);
    if (!existsSync(target)) {
      await mkdir(target, { recursive: true });
      createdFolders.push(folder);
    }
  }

  const blockSource = await readFile(
    join(templatesDir, 'vault', 'CLAUDE.md.block.template'),
    'utf8',
  );
  const rendered = blockSource.replace(/\{\{RECALL_CMD\}\}/g, recallCommand(opts.flavor));
  const { action } = await upsertSentinelBlock({
    path: join(vaultPath, 'CLAUDE.md'),
    content: rendered,
  });

  return { vaultPath, createdFolders, claudeMdAction: action };
}
