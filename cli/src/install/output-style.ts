import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_OUTPUT_STYLES_DIR = join(homedir(), '.claude', 'output-styles');
export const DEFAULT_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

export type FlavorChoice = 'marsh' | 'terse';

export interface InstallOutputStyleOptions {
  choice: FlavorChoice;
  assetsDir?: string;
  outputStylesDir?: string;
  settingsPath?: string;
  legacyName?: string;
}

export interface InstallOutputStyleResult {
  stylePath: string;
  installed: boolean;
  migrated: boolean;
  priorValue: string | null;
}

export interface UninstallOutputStyleOptions {
  styleName: string;
  priorValue: string | null;
  outputStylesDir?: string;
  settingsPath?: string;
}

export interface UninstallOutputStyleResult {
  styleRemoved: boolean;
  settingsRestored: boolean;
}

export function getAssetsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'assets', 'marsh.md'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Could not locate metalmind assets directory');
    }
    dir = parent;
  }
  return join(dir, 'assets');
}

function flavorTitle(choice: FlavorChoice): string {
  return choice === 'marsh' ? 'Marsh' : 'Terse';
}

function flavorDescription(choice: FlavorChoice): string {
  return choice === 'marsh'
    ? 'Terse Era-1 Inquisitor voice — fragments, no filler, no pleasantries'
    : 'Terse engineering voice — fragments, no filler, no pleasantries';
}

function rewriteFrontmatter(body: string, choice: FlavorChoice): string {
  const match = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return body;
  const rest = body.slice(match[0].length);
  const lines = (match[1] ?? '').split('\n').filter((line) => {
    const key = line.split(':')[0]?.trim();
    return key !== 'name' && key !== 'description';
  });
  const newFrontmatter = [
    '---',
    `name: ${flavorTitle(choice)}`,
    `description: ${flavorDescription(choice)}`,
    ...lines,
    '---',
  ].join('\n');
  return `${newFrontmatter}\n${rest}`;
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

async function writeSettings(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

async function findLegacyFile(
  outputStylesDir: string,
  declared: string | undefined,
): Promise<string | null> {
  const candidates = [declared, 'caveman'].filter(
    (name): name is string => !!name && name !== 'marsh' && name !== 'terse',
  );
  for (const name of candidates) {
    const path = join(outputStylesDir, `${name}.md`);
    if (existsSync(path)) return path;
  }
  return null;
}

export async function installOutputStyle(
  opts: InstallOutputStyleOptions,
): Promise<InstallOutputStyleResult> {
  const assetsDir = opts.assetsDir ?? getAssetsDir();
  const outputStylesDir = opts.outputStylesDir ?? DEFAULT_OUTPUT_STYLES_DIR;
  const settingsPath = opts.settingsPath ?? DEFAULT_SETTINGS_PATH;
  const stylePath = join(outputStylesDir, `${opts.choice}.md`);

  await mkdir(outputStylesDir, { recursive: true });

  const settings = await readSettings(settingsPath);
  const priorValue = typeof settings.outputStyle === 'string' ? settings.outputStyle : null;

  let installed = false;
  let migrated = false;
  if (!existsSync(stylePath)) {
    const legacyFile = await findLegacyFile(outputStylesDir, priorValue ?? undefined);
    if (legacyFile) {
      const body = await readFile(legacyFile, 'utf8');
      await writeFile(stylePath, rewriteFrontmatter(body, opts.choice), 'utf8');
      await unlink(legacyFile);
      migrated = true;
    } else {
      await copyFile(join(assetsDir, `${opts.choice}.md`), stylePath);
      installed = true;
    }
  }

  settings.outputStyle = opts.choice;
  await writeSettings(settingsPath, settings);

  return { stylePath, installed, migrated, priorValue };
}

export async function uninstallOutputStyle(
  opts: UninstallOutputStyleOptions,
): Promise<UninstallOutputStyleResult> {
  const outputStylesDir = opts.outputStylesDir ?? DEFAULT_OUTPUT_STYLES_DIR;
  const settingsPath = opts.settingsPath ?? DEFAULT_SETTINGS_PATH;
  const stylePath = join(outputStylesDir, `${opts.styleName}.md`);

  let styleRemoved = false;
  if (existsSync(stylePath)) {
    await unlink(stylePath);
    styleRemoved = true;
  }

  let settingsRestored = false;
  if (existsSync(settingsPath)) {
    const settings = await readSettings(settingsPath);
    if (settings.outputStyle === opts.styleName) {
      if (opts.priorValue) {
        settings.outputStyle = opts.priorValue;
      } else {
        delete settings.outputStyle;
      }
      await writeSettings(settingsPath, settings);
      settingsRestored = true;
    }
  }

  // Clean up empty output-styles dir if we removed our only file
  const remaining = existsSync(outputStylesDir) ? (await readdir(outputStylesDir)).length : 0;
  void remaining;

  return { styleRemoved, settingsRestored };
}
