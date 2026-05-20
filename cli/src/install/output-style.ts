import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_OUTPUT_STYLES_DIR = join(homedir(), '.claude', 'output-styles');
export const DEFAULT_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

export type FlavorChoice = 'marsh' | 'telegraph';

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
  healed: boolean;
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

function flavorName(choice: FlavorChoice): string {
  return choice;
}

function flavorDescription(choice: FlavorChoice): string {
  return choice === 'marsh'
    ? 'Era-1 Inquisitor voice — spikes through eyes, no warmth, no filler'
    : 'Telegraph operator voice — every word costs, every word counts';
}

interface ParsedFrontmatter {
  body: string;
  nameValue: string | null;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { body: content, nameValue: null };
  const fm = match[1] ?? '';
  const body = content.slice(match[0].length);
  const nameLine = fm.split('\n').find((line) => line.trimStart().startsWith('name:'));
  const nameValue = nameLine ? (nameLine.split(':')[1] ?? '').trim() : null;
  return { body, nameValue };
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
    `name: ${flavorName(choice)}`,
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
  const candidates = [declared, 'caveman', 'terse'].filter(
    (name): name is string => !!name && name !== 'marsh' && name !== 'telegraph',
  );
  for (const name of candidates) {
    const path = join(outputStylesDir, `${name}.md`);
    if (existsSync(path)) return path;
  }
  return null;
}

export interface MigrateTerseToTelegraphOptions {
  outputStylesDir?: string;
  settingsPath?: string;
  assetsDir?: string;
}

export interface MigrateTerseToTelegraphResult {
  migrated: boolean;
  fileRenamed: boolean;
  settingsUpdated: boolean;
}

/**
 * Rename a previously-installed `terse` output style to `telegraph` (the new
 * persona-named slug shipped in 0.8.14). Safe to call on every stamp — no-ops
 * when no `terse` state is present.
 *
 * Behaviour:
 *  - If `~/.claude/output-styles/terse.md` exists and `telegraph.md` does not:
 *    rewrite frontmatter (`name: terse` → `name: telegraph`) and rename.
 *    Body is preserved so user edits survive.
 *  - If both exist, the legacy `terse.md` is deleted (telegraph wins).
 *  - If `settings.outputStyle === 'terse'`, point it at `'telegraph'`.
 */
export async function migrateTerseToTelegraph(
  opts: MigrateTerseToTelegraphOptions = {},
): Promise<MigrateTerseToTelegraphResult> {
  const outputStylesDir = opts.outputStylesDir ?? DEFAULT_OUTPUT_STYLES_DIR;
  const settingsPath = opts.settingsPath ?? DEFAULT_SETTINGS_PATH;
  const assetsDir = opts.assetsDir ?? getAssetsDir();

  const tersePath = join(outputStylesDir, 'terse.md');
  const telegraphPath = join(outputStylesDir, 'telegraph.md');

  const hasTerse = existsSync(tersePath);
  const hasTelegraph = existsSync(telegraphPath);

  const settings = await readSettings(settingsPath);
  const current = typeof settings.outputStyle === 'string' ? settings.outputStyle : null;
  const pointsAtTerse = current === 'terse';

  if (!hasTerse && !pointsAtTerse) {
    return { migrated: false, fileRenamed: false, settingsUpdated: false };
  }

  let fileRenamed = false;
  if (hasTerse && !hasTelegraph) {
    const body = await readFile(tersePath, 'utf8');
    await writeFile(telegraphPath, rewriteFrontmatter(body, 'telegraph'), 'utf8');
    await unlink(tersePath);
    fileRenamed = true;
  } else if (hasTerse && hasTelegraph) {
    // telegraph already present — drop the legacy file
    await unlink(tersePath);
    fileRenamed = true;
  } else if (!hasTerse && pointsAtTerse && !hasTelegraph) {
    // settings point at a missing file — fall back to bundled asset
    await mkdir(outputStylesDir, { recursive: true });
    await copyFile(join(assetsDir, 'telegraph.md'), telegraphPath);
    fileRenamed = true;
  }

  let settingsUpdated = false;
  if (pointsAtTerse) {
    settings.outputStyle = 'telegraph';
    await writeSettings(settingsPath, settings);
    settingsUpdated = true;
  }

  return { migrated: true, fileRenamed, settingsUpdated };
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
  let healed = false;
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
  } else {
    const onDisk = await readFile(stylePath, 'utf8');
    const onDiskParsed = parseFrontmatter(onDisk);
    const isCaseMismatchedTwin =
      onDiskParsed.nameValue !== null &&
      onDiskParsed.nameValue !== opts.choice &&
      onDiskParsed.nameValue.toLowerCase() === opts.choice.toLowerCase();
    if (isCaseMismatchedTwin) {
      const assetContent = await readFile(join(assetsDir, `${opts.choice}.md`), 'utf8');
      const assetBody = parseFrontmatter(assetContent).body;
      if (onDiskParsed.body === assetBody) {
        await writeFile(stylePath, assetContent, 'utf8');
        healed = true;
      }
    }
  }

  settings.outputStyle = opts.choice;
  await writeSettings(settingsPath, settings);

  return { stylePath, installed, migrated, healed, priorValue };
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
