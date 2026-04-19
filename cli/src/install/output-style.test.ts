import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installOutputStyle, uninstallOutputStyle } from './output-style.js';

describe('output-style', () => {
  let tmp: string;
  let assetsDir: string;
  let outputStylesDir: string;
  let settingsPath: string;

  const assetTemplate = (name: string) =>
    `---
name: ${name}
description: ${name} description
keep-coding-instructions: true
---

# ${name} Voice

body content
`;

  const userAuthoredCaveman = `---
name: Caveman
description: Terse engineering voice
keep-coding-instructions: true
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
    await writeFile(join(assetsDir, 'marsh.md'), assetTemplate('Marsh'), 'utf8');
    await writeFile(join(assetsDir, 'terse.md'), assetTemplate('Terse'), 'utf8');
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
    expect(written).toContain('name: Marsh');
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
    expect(written).toContain('name: Marsh');
    expect(written).toContain('description: Terse Era-1 Inquisitor voice');
    expect(written).toContain('keep-coding-instructions: true');
    expect(written).toContain('Custom body the user edited.');
  });

  it('updates settings.json outputStyle to the chosen flavor', async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ outputStyle: 'default', env: { FOO: 'bar' } }),
      'utf8',
    );

    await installOutputStyle({
      choice: 'terse',
      assetsDir,
      outputStylesDir,
      settingsPath,
    });

    const raw = await readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    expect(settings.outputStyle).toBe('terse');
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
      choice: 'terse',
      assetsDir,
      outputStylesDir,
      settingsPath,
    });

    await uninstallOutputStyle({
      styleName: 'terse',
      priorValue: null,
      outputStylesDir,
      settingsPath,
    });

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    expect(settings.outputStyle).toBeUndefined();
  });

  it('re-run is idempotent — does not re-migrate when file already exists', async () => {
    await mkdir(outputStylesDir, { recursive: true });
    await writeFile(join(outputStylesDir, 'marsh.md'), 'existing marsh\n', 'utf8');

    const result = await installOutputStyle({
      choice: 'marsh',
      assetsDir,
      outputStylesDir,
      settingsPath,
    });

    expect(result.installed).toBe(false);
    expect(result.migrated).toBe(false);
    expect(await readFile(result.stylePath, 'utf8')).toBe('existing marsh\n');
  });
});
