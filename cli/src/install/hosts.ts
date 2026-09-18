import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MetalmindHost } from '../config.js';

export type { MetalmindHost } from '../config.js';

export interface HostsDetectionResult {
  claude: boolean;
  codex: boolean;
  cursor: boolean;
  antigravity: boolean;
}

export interface DetectHostsOptions {
  /** Override $HOME for testing. Defaults to os.homedir(). */
  home?: string;
}

export const HOST_DIRS: Record<MetalmindHost, string> = {
  claude: '.claude',
  codex: '.codex',
  cursor: '.cursor',
  antigravity: '.gemini',
};

export function detectHosts(opts: DetectHostsOptions = {}): HostsDetectionResult {
  const home = opts.home ?? homedir();
  return {
    claude: existsSync(join(home, HOST_DIRS.claude)),
    codex: existsSync(join(home, HOST_DIRS.codex)),
    cursor: existsSync(join(home, HOST_DIRS.cursor)),
    antigravity: existsSync(join(home, HOST_DIRS.antigravity, 'antigravity')),
  };
}

/** Convert detection result to an ordered list of detected hosts. */
export function detectedAsList(detection: HostsDetectionResult): MetalmindHost[] {
  const out: MetalmindHost[] = [];
  if (detection.claude) out.push('claude');
  if (detection.codex) out.push('codex');
  if (detection.cursor) out.push('cursor');
  if (detection.antigravity) out.push('antigravity');
  return out;
}
