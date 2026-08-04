import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installOutputStyle,
  migrateTerseToTelegraph,
  refreshOutputStyleAssets,
  uninstallOutputStyle,
} from './output-style.js';

describe('output-style', () => {
  let tmp: string;
  let assetsDir: string;
  let outputStylesDir: string;
  let settingsPath: string;

  const assetTemplate = (name: string) =>
    `---
name: ${name}
description: ${name} description
---

# ${name} Voice

body content
`;

  const userAuthoredCaveman = `---
name: caveman
description: Terse engineering voice
---

# Caveman Voice

Custom body the user edited.
`;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-style-'));
    assetsDir = join(tmp, 'assets');
    outputStylesDir = join(tmp, 'output-styles');
    settingsPath = join(tmp, 'settings.json');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, 'marsh.md'), assetTemplate('marsh'), 'utf8');
    await writeFile(join(assetsDir, 'telegraph.md'), assetTemplate('telegraph'), 'utf8');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('fresh install copies bundled marsh.md', async () => {
    const result = await installOutputStyle({
      choice: 'marsh',
      assetsDir,
      outputStylesDir,
      settingsPath,
    });

    expect(result.installed).toBe(true);
    expect(result.migrated).toBe(false);
    expect(existsSync(result.stylePath)).toBe(true);
    const written = await readFile(result.stylePath, 'utf8');
    expect(written).toContain('name: marsh');
  });

  it('migrates user caveman.md preserving body, rewriting frontmatter', async () => {
    await mkdir(outputStylesDir, { recursive: true });
    await writeFile(join(outputStylesDir, 'caveman.md'), userAuthoredCaveman, 'utf8');
    await writeFile(settingsPath, JSON.stringify({ outputStyle: 'caveman' }), 'utf8');

    const result = await installOutputStyle({
      choice: 'marsh',
      assetsDir,
      outputStylesDir,
      settingsPath,
    });

    expect(result.migrated).toBe(true);
    expect(result.priorValue).toBe('caveman');
    expect(existsSync(join(outputStylesDir, 'caveman.md'))).toBe(false);

    const written = await readFile(result.stylePath, 'utf8');
    expect(written).toContain('name: marsh');
    expect(written).toContain('description: Era-1 Inquisitor voice');
    expect(written).toContain('Custom body the user edited.');
  });

  it('updates settings.json outputStyle to the chosen flavor', async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ outputStyle: 'default', env: { FOO: 'bar' } }),
      'utf8',
    );

    await installOutputStyle({
      choice: 'telegraph',
      assetsDir,
      outputStylesDir,
      settingsPath,
    });

    const raw = await readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    expect(settings.outputStyle).toBe('telegraph');
    expect(settings.env.FOO).toBe('bar');
  });

  it('captures priorValue so uninstall can restore it', async () => {
    await writeFile(settingsPath, JSON.stringify({ outputStyle: 'my-style' }), 'utf8');

    const install = await installOutputStyle({
      choice: 'marsh',
      assetsDir,
      outputStylesDir,
      settingsPath,
    });

    expect(install.priorValue).toBe('my-style');

    const uninstall = await uninstallOutputStyle({
      styleName: 'marsh',
      priorValue: install.priorValue,
      outputStylesDir,
      settingsPath,
    });

    expect(uninstall.styleRemoved).toBe(true);
    expect(uninstall.settingsRestored).toBe(true);
    const restored = JSON.parse(await readFile(settingsPath, 'utf8'));
    expect(restored.outputStyle).toBe('my-style');
  });

  it('uninstall removes outputStyle when no prior value', async () => {
    await installOutputStyle({
      choice: 'telegraph',
      assetsDir,
      outputStylesDir,
      settingsPath,
    });

    await uninstallOutputStyle({
      styleName: 'telegraph',
      priorValue: null,
      outputStylesDir,
      settingsPath,
    });

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    expect(settings.outputStyle).toBeUndefined();
  });

  describe('asset refresh - stamp owns the style file', () => {
    it('overwrites a stale on-disk body from the bundled asset (updated: true)', async () => {
      await mkdir(outputStylesDir, { recursive: true });
      await writeFile(join(outputStylesDir, 'marsh.md'), 'stale previous-release body\n', 'utf8');

      const result = await installOutputStyle({
        choice: 'marsh',
        assetsDir,
        outputStylesDir,
        settingsPath,
      });

      expect(result.installed).toBe(false);
      expect(result.migrated).toBe(false);
      expect(result.updated).toBe(true);
      const asset = await readFile(join(assetsDir, 'marsh.md'), 'utf8');
      expect(await readFile(result.stylePath, 'utf8')).toBe(asset);
    });

    it('leaves a byte-identical file untouched (updated: false)', async () => {
      await mkdir(outputStylesDir, { recursive: true });
      const asset = await readFile(join(assetsDir, 'marsh.md'), 'utf8');
      await writeFile(join(outputStylesDir, 'marsh.md'), asset, 'utf8');

      const result = await installOutputStyle({
        choice: 'marsh',
        assetsDir,
        outputStylesDir,
        settingsPath,
      });

      expect(result.installed).toBe(false);
      expect(result.updated).toBe(false);
    });

    it('overwrites a broken-stamp case-twin (name: Marsh) with the asset', async () => {
      await mkdir(outputStylesDir, { recursive: true });
      const asset = await readFile(join(assetsDir, 'marsh.md'), 'utf8');
      const body = asset.replace(/^---\n[\s\S]*?\n---\n?/, '');
      await writeFile(
        join(outputStylesDir, 'marsh.md'),
        `---\nname: Marsh\ndescription: Marsh description\nkeep-coding-instructions: true\n---\n${body}`,
        'utf8',
      );

      const result = await installOutputStyle({
        choice: 'marsh',
        assetsDir,
        outputStylesDir,
        settingsPath,
      });

      expect(result.updated).toBe(true);
      const written = await readFile(result.stylePath, 'utf8');
      expect(written).toContain('name: marsh');
      expect(written).not.toContain('keep-coding-instructions');
    });
  });

  describe('refreshOutputStyleAssets - stamp-time refresh without settings takeover', () => {
    it('refreshes every existing stale style file and reports which', async () => {
      await mkdir(outputStylesDir, { recursive: true });
      await writeFile(join(outputStylesDir, 'marsh.md'), 'old marsh body\n', 'utf8');
      await writeFile(join(outputStylesDir, 'telegraph.md'), 'old telegraph body\n', 'utf8');

      const result = await refreshOutputStyleAssets({ assetsDir, outputStylesDir });

      expect(result.refreshed.sort()).toEqual(['marsh', 'telegraph']);
      const marshAsset = await readFile(join(assetsDir, 'marsh.md'), 'utf8');
      expect(await readFile(join(outputStylesDir, 'marsh.md'), 'utf8')).toBe(marshAsset);
    });

    it('skips missing files and byte-identical files', async () => {
      await mkdir(outputStylesDir, { recursive: true });
      const asset = await readFile(join(assetsDir, 'telegraph.md'), 'utf8');
      await writeFile(join(outputStylesDir, 'telegraph.md'), asset, 'utf8');

      const result = await refreshOutputStyleAssets({ assetsDir, outputStylesDir });

      expect(result.refreshed).toEqual([]);
      expect(existsSync(join(outputStylesDir, 'marsh.md'))).toBe(false);
    });

    it('never touches settings.json', async () => {
      await mkdir(outputStylesDir, { recursive: true });
      await writeFile(join(outputStylesDir, 'marsh.md'), 'old body\n', 'utf8');
      await writeFile(settingsPath, JSON.stringify({ outputStyle: 'my-custom-style' }), 'utf8');

      await refreshOutputStyleAssets({ assetsDir, outputStylesDir });

      const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
      expect(settings.outputStyle).toBe('my-custom-style');
    });
  });

  describe('migrateTerseToTelegraph (0.8.14 rename)', () => {
    it('renames terse.md → telegraph.md and rewrites frontmatter name', async () => {
      await mkdir(outputStylesDir, { recursive: true });
      const userBody = `---\nname: terse\ndescription: old desc\n---\n\n# Body the user kept\n`;
      await writeFile(join(outputStylesDir, 'terse.md'), userBody, 'utf8');
      await writeFile(settingsPath, JSON.stringify({ outputStyle: 'terse' }), 'utf8');

      const result = await migrateTerseToTelegraph({
        assetsDir,
        outputStylesDir,
        settingsPath,
      });

      expect(result.migrated).toBe(true);
      expect(result.fileRenamed).toBe(true);
      expect(result.settingsUpdated).toBe(true);
      expect(existsSync(join(outputStylesDir, 'terse.md'))).toBe(false);
      const newFile = await readFile(join(outputStylesDir, 'telegraph.md'), 'utf8');
      expect(newFile).toContain('name: telegraph');
      expect(newFile).toContain('# Body the user kept');
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
      expect(settings.outputStyle).toBe('telegraph');
    });

    it('no-op when neither terse.md nor terse setting present', async () => {
      await mkdir(outputStylesDir, { recursive: true });
      await writeFile(settingsPath, JSON.stringify({ outputStyle: 'marsh' }), 'utf8');

      const result = await migrateTerseToTelegraph({
        assetsDir,
        outputStylesDir,
        settingsPath,
      });

      expect(result.migrated).toBe(false);
      expect(result.fileRenamed).toBe(false);
      expect(result.settingsUpdated).toBe(false);
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
      expect(settings.outputStyle).toBe('marsh');
    });

    it('drops legacy terse.md if telegraph.md already exists', async () => {
      await mkdir(outputStylesDir, { recursive: true });
      await writeFile(join(outputStylesDir, 'terse.md'), 'legacy body\n', 'utf8');
      await writeFile(join(outputStylesDir, 'telegraph.md'), 'new body\n', 'utf8');
      await writeFile(settingsPath, JSON.stringify({ outputStyle: 'terse' }), 'utf8');

      const result = await migrateTerseToTelegraph({
        assetsDir,
        outputStylesDir,
        settingsPath,
      });

      expect(result.migrated).toBe(true);
      expect(result.fileRenamed).toBe(true);
      expect(result.settingsUpdated).toBe(true);
      expect(existsSync(join(outputStylesDir, 'terse.md'))).toBe(false);
      expect(await readFile(join(outputStylesDir, 'telegraph.md'), 'utf8')).toBe('new body\n');
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
      expect(settings.outputStyle).toBe('telegraph');
    });

    it('copies bundled asset when settings point at terse but no file exists', async () => {
      await mkdir(outputStylesDir, { recursive: true });
      await writeFile(settingsPath, JSON.stringify({ outputStyle: 'terse' }), 'utf8');

      const result = await migrateTerseToTelegraph({
        assetsDir,
        outputStylesDir,
        settingsPath,
      });

      expect(result.migrated).toBe(true);
      expect(result.fileRenamed).toBe(true);
      expect(result.settingsUpdated).toBe(true);
      expect(existsSync(join(outputStylesDir, 'telegraph.md'))).toBe(true);
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
      expect(settings.outputStyle).toBe('telegraph');
    });
  });
});
