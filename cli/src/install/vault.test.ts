import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupVault, VAULT_FOLDERS } from './vault.js';

describe('setupVault', () => {
  let tmp: string;
  let templatesDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-vault-'));
    templatesDir = join(tmp, 'templates');
    await mkdir(join(templatesDir, 'vault'), { recursive: true });
    await writeFile(
      join(templatesDir, 'vault', 'CLAUDE.md.template'),
      '# test vault claude md\nrecall via {{RECALL_CMD}}\n',
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('creates all folders on fresh install', async () => {
    const vaultPath = join(tmp, 'vault');
    const result = await setupVault({ vaultPath, templatesDir, flavor: 'scadrial' });

    expect(result.vaultPath).toBe(vaultPath);
    expect(result.createdFolders).toEqual([...VAULT_FOLDERS]);
    expect(result.wroteClaudeMd).toBe(true);
    for (const folder of VAULT_FOLDERS) {
      expect(existsSync(join(vaultPath, folder))).toBe(true);
    }
    expect(existsSync(join(vaultPath, 'CLAUDE.md'))).toBe(true);
    const rendered = await readFile(join(vaultPath, 'CLAUDE.md'), 'utf8');
    expect(rendered).toContain('metalmind tap copper');
    expect(rendered).not.toContain('{{RECALL_CMD}}');
  });

  it('renders classic recall verb when flavor=classic', async () => {
    const vaultPath = join(tmp, 'vault');
    await setupVault({ vaultPath, templatesDir, flavor: 'classic' });
    const rendered = await readFile(join(vaultPath, 'CLAUDE.md'), 'utf8');
    expect(rendered).toContain('metalmind recall');
    expect(rendered).not.toContain('tap copper');
  });

  it('is idempotent on re-run', async () => {
    const vaultPath = join(tmp, 'vault');
    await setupVault({ vaultPath, templatesDir, flavor: 'scadrial' });
    const second = await setupVault({ vaultPath, templatesDir, flavor: 'scadrial' });
    expect(second.createdFolders).toEqual([]);
    expect(second.wroteClaudeMd).toBe(false);
  });

  it('preserves existing CLAUDE.md', async () => {
    const vaultPath = join(tmp, 'vault');
    await mkdir(vaultPath, { recursive: true });
    await writeFile(join(vaultPath, 'CLAUDE.md'), '# user-customized\n', 'utf8');

    const result = await setupVault({ vaultPath, templatesDir, flavor: 'scadrial' });

    expect(result.wroteClaudeMd).toBe(false);
    const contents = await readFile(join(vaultPath, 'CLAUDE.md'), 'utf8');
    expect(contents).toBe('# user-customized\n');
  });

  it('expands tilde in vault path', async () => {
    process.env.HOME = tmp;
    const result = await setupVault({ vaultPath: '~/my-vault', templatesDir, flavor: 'scadrial' });
    expect(result.vaultPath).toBe(join(tmp, 'my-vault'));
    expect(existsSync(join(tmp, 'my-vault', 'Work'))).toBe(true);
  });
});
