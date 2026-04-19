import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';
import { getTemplatesDir } from '../util/paths.js';

export const SERENA_PACKAGE = 'serena-agent';
export const SERENA_PYTHON = '3.13';
export const DEFAULT_SERENA_ROOT = join(homedir(), '.serena');
export const SERENA_CONFIG_FILE = 'serena_config.yml';

export interface InstallSerenaOptions {
  templatesDir?: string;
  serenaRoot?: string;
  homeDir?: string;
  skipToolInstall?: boolean;
}

export interface InstallSerenaResult {
  configPath: string;
  installed: boolean;
  alreadyInstalled: boolean;
  wroteConfig: boolean;
}

async function isSerenaInstalled(): Promise<boolean> {
  const res = await runCommand('serena', ['--version']);
  return res.ok;
}

export async function installSerena(opts: InstallSerenaOptions = {}): Promise<InstallSerenaResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const serenaRoot = opts.serenaRoot ?? DEFAULT_SERENA_ROOT;
  const homeValue = opts.homeDir ?? homedir();
  const configPath = join(serenaRoot, SERENA_CONFIG_FILE);

  let installed = false;
  let alreadyInstalled = false;

  if (await isSerenaInstalled()) {
    alreadyInstalled = true;
  } else if (!opts.skipToolInstall) {
    const res = await runCommand(
      'uv',
      ['tool', 'install', '-p', SERENA_PYTHON, `${SERENA_PACKAGE}@latest`, '--prerelease=allow'],
      { timeoutMs: 300_000 },
    );
    if (!res.ok) {
      throw new Error(`uv tool install ${SERENA_PACKAGE} failed: ${res.stderr || res.stdout}`);
    }
    installed = true;
  }

  await mkdir(serenaRoot, { recursive: true });
  let wroteConfig = false;
  if (!existsSync(configPath)) {
    const template = await readFile(join(templatesDir, 'serena', SERENA_CONFIG_FILE), 'utf8');
    const rendered = template.replace(/\{\{HOME\}\}/g, homeValue);
    await writeFile(configPath, rendered, 'utf8');
    wroteConfig = true;
  }

  return { configPath, installed, alreadyInstalled, wroteConfig };
}

export async function uninstallSerena(): Promise<{ uninstalled: boolean }> {
  if (!(await isSerenaInstalled())) {
    return { uninstalled: false };
  }
  const res = await runCommand('uv', ['tool', 'uninstall', SERENA_PACKAGE], { timeoutMs: 60_000 });
  return { uninstalled: res.ok };
}
