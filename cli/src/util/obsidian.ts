import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { runCommand } from './exec.js';

export interface ObsidianDetection {
  found: boolean;
  location?: string;
  installHint: string;
}

const HINT_BY_PLATFORM: Record<string, string> = {
  darwin: 'brew install --cask obsidian   # or https://obsidian.md/download',
  linux: 'flatpak install flathub md.obsidian.Obsidian   # or https://obsidian.md/download',
  win32: 'winget install Obsidian.Obsidian   # or https://obsidian.md/download',
};

function defaultHint(): string {
  return HINT_BY_PLATFORM[platform()] ?? 'https://obsidian.md/download';
}

export async function detectObsidian(): Promise<ObsidianDetection> {
  const installHint = defaultHint();
  const home = homedir();
  const candidates: string[] = [];

  if (platform() === 'darwin') {
    candidates.push('/Applications/Obsidian.app', join(home, 'Applications', 'Obsidian.app'));
  } else if (platform() === 'linux') {
    candidates.push(
      join(home, '.config', 'obsidian'),
      join(home, '.var', 'app', 'md.obsidian.Obsidian'),
      '/snap/obsidian',
    );
  } else if (platform() === 'win32') {
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA;
    if (appData) candidates.push(join(appData, 'obsidian'));
    if (localAppData) candidates.push(join(localAppData, 'Programs', 'Obsidian'));
  }

  for (const path of candidates) {
    if (existsSync(path)) return { found: true, location: path, installHint };
  }

  // Fallback: a CLI named `obsidian` on PATH (Linux distros sometimes ship one).
  const cli = await runCommand('which', ['obsidian']);
  if (cli.ok && cli.stdout.trim()) {
    return { found: true, location: cli.stdout.trim(), installHint };
  }

  return { found: false, installHint };
}
