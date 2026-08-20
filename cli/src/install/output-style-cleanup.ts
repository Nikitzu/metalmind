import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  clearOutputStyleSessionStartHook,
  clearOutputStyleUserPromptSubmitHook,
} from './settings.js';

export const DEFAULT_OUTPUT_STYLES_DIR = join(homedir(), '.claude', 'output-styles');
export const DEFAULT_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
export const DEFAULT_SKILLS_DIR = join(homedir(), '.claude', 'skills');
export const DEFAULT_HOOKS_DIR = join(homedir(), '.claude', 'hooks');

/** Every style slug metalmind ever installed, including the pre-0.8.14 names. */
const RETIRED_STYLE_SLUGS = ['marsh', 'telegraph', 'terse', 'caveman'] as const;

/** Skill bundles that existed only to self-trigger a retired output style. */
const RETIRED_SKILL_SLUGS = ['marsh', 'telegraph'] as const;

const RETIRED_HOOK_FILENAMES = [
  'metalmind-output-style-activate.sh',
  'metalmind-output-style-reanchor.sh',
] as const;

export interface CleanupOutputStyleOptions {
  /**
   * The value `settings.outputStyle` held before metalmind first overwrote it,
   * carried in the config until the v4 → v5 migration dropped the field. When
   * present and non-retired, the setting is restored to it rather than deleted.
   */
  priorValue?: string | null;
  outputStylesDir?: string;
  settingsPath?: string;
  skillsDir?: string;
  hooksDir?: string;
}

export interface CleanupOutputStyleResult {
  /** True when anything at all was removed or rewritten. */
  cleaned: boolean;
  stylesRemoved: string[];
  skillsRemoved: string[];
  hookScriptsRemoved: string[];
  sessionStartHookCleared: boolean;
  userPromptSubmitHookCleared: boolean;
  /** The value `settings.outputStyle` was set to, or null when the key was deleted. */
  settingsOutputStyle: string | null;
  settingsChanged: boolean;
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

function isRetiredStyle(value: unknown): value is string {
  return typeof value === 'string' && RETIRED_STYLE_SLUGS.includes(value as never);
}

/**
 * Remove every trace of the retired marsh / telegraph output styles.
 *
 * 0.24.0 dropped the output-style feature. The code going away does not undo
 * what earlier versions wrote into `~/.claude`, so an upgraded install would
 * otherwise keep two hook scripts firing on every session and every prompt,
 * pointed at a style file nothing maintains any more. This runs on `stamp` and
 * no-ops entirely on installs that never had the feature.
 *
 * `settings.outputStyle` is only touched when it names a retired style, so a
 * style the user chose themselves is never disturbed.
 */
export async function cleanupOutputStyle(
  opts: CleanupOutputStyleOptions = {},
): Promise<CleanupOutputStyleResult> {
  const outputStylesDir = opts.outputStylesDir ?? DEFAULT_OUTPUT_STYLES_DIR;
  const settingsPath = opts.settingsPath ?? DEFAULT_SETTINGS_PATH;
  const skillsDir = opts.skillsDir ?? DEFAULT_SKILLS_DIR;
  const hooksDir = opts.hooksDir ?? DEFAULT_HOOKS_DIR;

  const stylesRemoved: string[] = [];
  for (const slug of RETIRED_STYLE_SLUGS) {
    const path = join(outputStylesDir, `${slug}.md`);
    if (!existsSync(path)) continue;
    await rm(path, { force: true });
    stylesRemoved.push(slug);
  }

  const skillsRemoved: string[] = [];
  for (const slug of RETIRED_SKILL_SLUGS) {
    const path = join(skillsDir, slug);
    if (!existsSync(path)) continue;
    await rm(path, { recursive: true, force: true });
    skillsRemoved.push(slug);
  }

  const hookScriptsRemoved: string[] = [];
  for (const filename of RETIRED_HOOK_FILENAMES) {
    const path = join(hooksDir, filename);
    if (!existsSync(path)) continue;
    await rm(path, { force: true });
    hookScriptsRemoved.push(filename);
  }

  const sessionStartHookCleared = await clearOutputStyleSessionStartHook(settingsPath);
  const userPromptSubmitHookCleared = await clearOutputStyleUserPromptSubmitHook(settingsPath);

  let settingsOutputStyle: string | null = null;
  let settingsChanged = false;
  if (existsSync(settingsPath)) {
    const settings = await readSettings(settingsPath);
    if (isRetiredStyle(settings.outputStyle)) {
      // Restoring to another retired slug would just recreate the problem.
      if (opts.priorValue && !isRetiredStyle(opts.priorValue)) {
        settings.outputStyle = opts.priorValue;
        settingsOutputStyle = opts.priorValue;
      } else {
        delete settings.outputStyle;
      }
      await writeSettings(settingsPath, settings);
      settingsChanged = true;
    } else if (typeof settings.outputStyle === 'string') {
      settingsOutputStyle = settings.outputStyle;
    }
  }

  const cleaned =
    stylesRemoved.length > 0 ||
    skillsRemoved.length > 0 ||
    hookScriptsRemoved.length > 0 ||
    sessionStartHookCleared ||
    userPromptSubmitHookCleared ||
    settingsChanged;

  return {
    cleaned,
    stylesRemoved,
    skillsRemoved,
    hookScriptsRemoved,
    sessionStartHookCleared,
    userPromptSubmitHookCleared,
    settingsOutputStyle,
    settingsChanged,
  };
}
