import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAliases, RC_SOURCE_SENTINEL, uninstallAliases } from './aliases.js';

describe('aliases', () => {
  let tmp: string;
  let templatesDir: string;
  let aliasesPath: string;
  let zshrcPath: string;
  let bashrcPath: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-aliases-'));
    templatesDir = join(tmp, 'templates');
    await mkdir(join(templatesDir, 'shell'), { recursive: true });
    await writeFile(
      join(templatesDir, 'shell', 'aliases.sh'),
      '# metalmind aliases\nalias vault-up="echo up"\n',
      'utf8',
    );
    aliasesPath = join(tmp, '.metalmind', 'aliases.sh');
    zshrcPath = join(tmp, '.zshrc');
    bashrcPath = join(tmp, '.bashrc');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('installs aliases and appends source block to zshrc', async () => {
    await writeFile(zshrcPath, '# user zshrc\nexport PATH=$PATH\n', 'utf8');
    const result = await installAliases({ templatesDir, aliasesPath, zshrcPath, bashrcPath });

    expect(result.wroteAliases).toBe(true);
    expect(result.appendedSource).toBe(true);
    expect(result.noRcFilesFound).toBe(false);
    expect(result.appendedTo).toEqual([zshrcPath]);
    expect(result.alreadySourcedIn).toEqual([]);
    expect(existsSync(aliasesPath)).toBe(true);
    const zshrc = await readFile(zshrcPath, 'utf8');
    expect(zshrc).toContain(RC_SOURCE_SENTINEL);
    expect(zshrc).toContain(aliasesPath);
  });

  it('reports that no rc file exists without failing', async () => {
    const result = await installAliases({ templatesDir, aliasesPath, zshrcPath, bashrcPath });
    expect(result.wroteAliases).toBe(true);
    expect(result.noRcFilesFound).toBe(true);
    expect(result.appendedSource).toBe(false);
    expect(result.alreadySourcedIn).toEqual([]);
  });

  it('appends to bashrc alone when only bashrc exists', async () => {
    await writeFile(bashrcPath, '# user bashrc\n', 'utf8');
    const result = await installAliases({ templatesDir, aliasesPath, zshrcPath, bashrcPath });

    expect(result.appendedTo).toEqual([bashrcPath]);
    expect(result.noRcFilesFound).toBe(false);
    expect(await readFile(bashrcPath, 'utf8')).toContain(RC_SOURCE_SENTINEL);
  });

  it('appends to both rc files when both exist', async () => {
    await writeFile(zshrcPath, '', 'utf8');
    await writeFile(bashrcPath, '', 'utf8');
    const result = await installAliases({ templatesDir, aliasesPath, zshrcPath, bashrcPath });

    expect(result.appendedTo).toEqual([zshrcPath, bashrcPath]);
  });

  it('reports an already-sourced rc file rather than an empty append list', async () => {
    await writeFile(zshrcPath, '', 'utf8');
    await installAliases({ templatesDir, aliasesPath, zshrcPath, bashrcPath });
    const first = await readFile(zshrcPath, 'utf8');
    const result = await installAliases({ templatesDir, aliasesPath, zshrcPath, bashrcPath });
    const second = await readFile(zshrcPath, 'utf8');

    expect(result.appendedSource).toBe(false);
    expect(result.appendedTo).toEqual([]);
    expect(result.alreadySourcedIn).toEqual([zshrcPath]);
    expect(result.noRcFilesFound).toBe(false);
    expect(second).toBe(first);
  });

  it('uninstalls aliases and removes source block', async () => {
    await writeFile(zshrcPath, '# user zshrc\n', 'utf8');
    await installAliases({ templatesDir, aliasesPath, zshrcPath, bashrcPath });
    const result = await uninstallAliases({ aliasesPath, zshrcPath, bashrcPath });

    expect(result.removedAliases).toBe(true);
    expect(result.removedSourceLine).toBe(true);
    expect(existsSync(aliasesPath)).toBe(false);
    const zshrc = await readFile(zshrcPath, 'utf8');
    expect(zshrc).not.toContain(RC_SOURCE_SENTINEL);
    expect(zshrc).toContain('# user zshrc');
  });

  it('uninstall is no-op when nothing installed', async () => {
    const result = await uninstallAliases({ aliasesPath, zshrcPath, bashrcPath });
    expect(result.removedAliases).toBe(false);
    expect(result.removedSourceLine).toBe(false);
  });
});
