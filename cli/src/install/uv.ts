import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';

export const UV_INSTALL_COMMAND = 'curl -LsSf https://astral.sh/uv/install.sh | sh';
const UV_INSTALL_BIN_DIR = join(homedir(), '.local', 'bin');

export interface InstallUvResult {
  installed: boolean;
  pathPrepended: boolean;
  binPath?: string;
  stderr?: string;
}

/**
 * Run the official Astral installer for uv (curl … | sh). Output is streamed
 * to the user via inherited stdio. On success we prepend ~/.local/bin to
 * process.env.PATH so the rest of `metalmind init` sees the freshly-installed
 * binary without requiring a shell restart.
 *
 * The installer is read-only on the system except for ~/.local/bin and the
 * user's shell rc files (which it patches with PATH updates by default).
 */
export async function installUv(): Promise<InstallUvResult> {
  const res = await runCommand('sh', ['-c', UV_INSTALL_COMMAND], {
    timeoutMs: 120_000,
    inheritStdio: true,
  });

  if (!res.ok) {
    return { installed: false, pathPrepended: false, stderr: res.stderr };
  }

  const candidate = join(UV_INSTALL_BIN_DIR, 'uv');
  if (!existsSync(candidate)) {
    return {
      installed: false,
      pathPrepended: false,
      stderr: `installer reported success but ${candidate} was not created`,
    };
  }

  const currentPath = process.env.PATH ?? '';
  const segments = currentPath.split(':');
  let pathPrepended = false;
  if (!segments.includes(UV_INSTALL_BIN_DIR)) {
    process.env.PATH = `${UV_INSTALL_BIN_DIR}:${currentPath}`;
    pathPrepended = true;
  }

  return { installed: true, pathPrepended, binPath: candidate };
}
