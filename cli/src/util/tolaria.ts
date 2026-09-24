import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export interface TolariaDetection {
  found: boolean;
  location?: string;
  installHint: string;
}

const DOWNLOAD_URL = 'https://refactoringhq.github.io/tolaria/download/';

export async function detectTolaria(): Promise<TolariaDetection> {
  const installHint =
    platform() === 'darwin' ? `brew install --cask tolaria   # or ${DOWNLOAD_URL}` : DOWNLOAD_URL;
  const home = homedir();
  const candidates = [join(home, '.config', 'com.tolaria.app')];
  if (platform() === 'darwin') {
    candidates.push('/Applications/Tolaria.app', join(home, 'Applications', 'Tolaria.app'));
  }
  for (const path of candidates) {
    if (existsSync(path)) return { found: true, location: path, installHint };
  }
  return { found: false, installHint };
}
