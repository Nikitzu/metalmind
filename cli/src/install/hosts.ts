import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MetalmindHost } from '../config.js';

export type { MetalmindHost } from '../config.js';

export interface HostsDetectionResult {
  claude: boolean;
  codex: boolean;
}

export interface DetectHostsOptions {
  /** Override $HOME for testing. Defaults to os.homedir(). */
  home?: string;
}

export const HOST_DIRS: Record<MetalmindHost, string> = {
  claude: '.claude',
  codex: '.codex',
};

export function detectHosts(opts: DetectHostsOptions = {}): HostsDetectionResult {
  const home = opts.home ?? homedir();
  return {
    claude: existsSync(join(home, HOST_DIRS.claude)),
    codex: existsSync(join(home, HOST_DIRS.codex)),
  };
}

/** Convert detection result to an ordered list of detected hosts. */
export function detectedAsList(detection: HostsDetectionResult): MetalmindHost[] {
  const out: MetalmindHost[] = [];
  if (detection.claude) out.push('claude');
  if (detection.codex) out.push('codex');
  return out;
}
