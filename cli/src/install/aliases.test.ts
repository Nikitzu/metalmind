import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAliases, uninstallAliases, ZSHRC_SOURCE_SENTINEL } from './aliases.js';

describe('aliases', () => {
  let tmp: string;
  let templatesDir: string;
  let aliasesPath: string;
  let zshrcPath: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-aliases-'));
    templatesDir = join(tmp, 'templates');
    await mkdir(join(templatesDir, 'zsh'), { recursive: true });
    await writeFile(
      join(templatesDir, 'zsh', 'aliases.sh'),
      '# metalmind aliases\nalias vault-up="echo up"\n',
      'utf8',
    );
    aliasesPath = join(tmp, '.metalmind', 'aliases.sh');
    zshrcPath = join(tmp, '.zshrc');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('installs aliases and appends source block to zshrc', async () => {
    await writeFile(zshrcPath, '# user zshrc\nexport PATH=$PATH\n', 'utf8');
    const result = await installAliases({ templatesDir, aliasesPath, zshrcPath });

    expect(result.wroteAliases).toBe(true);
    expect(result.appendedSource).toBe(true);
    expect(result.zshrcMissing).toBe(false);
    expect(existsSync(aliasesPath)).toBe(true);
    const zshrc = await readFile(zshrcPath, 'utf8');
    expect(zshrc).toContain(ZSHRC_SOURCE_SENTINEL);
    expect(zshrc).toContain(aliasesPath);
  });

  it('reports missing zshrc without failing', async () => {
    const result = await installAliases({ templatesDir, aliasesPath, zshrcPath });
    expect(result.wroteAliases).toBe(true);
    expect(result.zshrcMissing).toBe(true);
    expect(result.appendedSource).toBe(false);
  });

  it('does not double-append source block on re-run', async () => {
    await writeFile(zshrcPath, '', 'utf8');
    await installAliases({ templatesDir, aliasesPath, zshrcPath });
    const first = await readFile(zshrcPath, 'utf8');
    const result = await installAliases({ templatesDir, aliasesPath, zshrcPath });
    const second = await readFile(zshrcPath, 'utf8');

    expect(result.appendedSource).toBe(false);
    expect(second).toBe(first);
  });

  it('uninstalls aliases and removes source block', async () => {
    await writeFile(zshrcPath, '# user zshrc\n', 'utf8');
    await installAliases({ templatesDir, aliasesPath, zshrcPath });
    const result = await uninstallAliases({ aliasesPath, zshrcPath });

    expect(result.removedAliases).toBe(true);
    expect(result.removedSourceLine).toBe(true);
    expect(existsSync(aliasesPath)).toBe(false);
    const zshrc = await readFile(zshrcPath, 'utf8');
    expect(zshrc).not.toContain(ZSHRC_SOURCE_SENTINEL);
    expect(zshrc).toContain('# user zshrc');
  });

  it('uninstall is no-op when nothing installed', async () => {
    const result = await uninstallAliases({ aliasesPath, zshrcPath });
    expect(result.removedAliases).toBe(false);
    expect(result.removedSourceLine).toBe(false);
  });
});
