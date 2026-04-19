import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_METALMIND_MARKERS } from '../util/sentinel.js';
import { setupVault, VAULT_FOLDERS } from './vault.js';

describe('setupVault', () => {
  let tmp: string;
  let templatesDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-vault-'));
    templatesDir = join(tmp, 'templates');
    await mkdir(join(templatesDir, 'vault'), { recursive: true });
    await writeFile(
      join(templatesDir, 'vault', 'CLAUDE.md.block.template'),
      '# test vault claude md\nrecall via {{RECALL_CMD}}\n',
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('creates all folders + writes sentinel-wrapped block on fresh install', async () => {
    const vaultPath = join(tmp, 'vault');
    const result = await setupVault({ vaultPath, templatesDir, flavor: 'scadrial' });

    expect(result.vaultPath).toBe(vaultPath);
    expect(result.createdFolders).toEqual([...VAULT_FOLDERS]);
    expect(result.claudeMdAction).toBe('created');
    for (const folder of VAULT_FOLDERS) {
      expect(existsSync(join(vaultPath, folder))).toBe(true);
    }
    const rendered = await readFile(join(vaultPath, 'CLAUDE.md'), 'utf8');
    expect(rendered).toContain(DEFAULT_METALMIND_MARKERS.begin);
    expect(rendered).toContain(DEFAULT_METALMIND_MARKERS.end);
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

  it('is idempotent: second run reports unchanged', async () => {
    const vaultPath = join(tmp, 'vault');
    await setupVault({ vaultPath, templatesDir, flavor: 'scadrial' });
    const second = await setupVault({ vaultPath, templatesDir, flavor: 'scadrial' });
    expect(second.createdFolders).toEqual([]);
    expect(second.claudeMdAction).toBe('unchanged');
  });

  it('inserts block into existing user CLAUDE.md without stomping user content', async () => {
    const vaultPath = join(tmp, 'vault');
    await mkdir(vaultPath, { recursive: true });
    await writeFile(join(vaultPath, 'CLAUDE.md'), '# user-customized\npersonal note\n', 'utf8');

    const result = await setupVault({ vaultPath, templatesDir, flavor: 'scadrial' });

    expect(result.claudeMdAction).toBe('inserted');
    const contents = await readFile(join(vaultPath, 'CLAUDE.md'), 'utf8');
    expect(contents).toContain('# user-customized');
    expect(contents).toContain('personal note');
    expect(contents).toContain(DEFAULT_METALMIND_MARKERS.begin);
    expect(contents).toContain('metalmind tap copper');
  });

  it('refreshes stale block on re-run with new flavor, preserves user content', async () => {
    const vaultPath = join(tmp, 'vault');
    await setupVault({ vaultPath, templatesDir, flavor: 'scadrial' });
    // user adds their own content below the managed block
    const current = await readFile(join(vaultPath, 'CLAUDE.md'), 'utf8');
    await writeFile(join(vaultPath, 'CLAUDE.md'), `${current}\n# my addition\n`, 'utf8');

    const second = await setupVault({ vaultPath, templatesDir, flavor: 'classic' });

    expect(second.claudeMdAction).toBe('updated');
    const contents = await readFile(join(vaultPath, 'CLAUDE.md'), 'utf8');
    expect(contents).toContain('metalmind recall');
    expect(contents).not.toContain('tap copper');
    expect(contents).toContain('# my addition');
  });

  it('expands tilde in vault path', async () => {
    process.env.HOME = tmp;
    const result = await setupVault({ vaultPath: '~/my-vault', templatesDir, flavor: 'scadrial' });
    expect(result.vaultPath).toBe(join(tmp, 'my-vault'));
    expect(existsSync(join(tmp, 'my-vault', 'Work'))).toBe(true);
  });
});
