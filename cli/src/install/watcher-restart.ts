import { platform } from 'node:os';
import { runCommand } from '../util/exec.js';
import { PLIST_NAME } from './launchd.js';
import { SERVICE_NAME } from './systemd.js';

export type WatcherRestartOutcome = 'restarted' | 'no-unit-found' | 'unsupported-platform';

/** Kick the vault-indexer watcher so a fresh Python process picks up newly
 *  installed dependencies. Used after `metalmind tap copper --rerank` triggers
 *  the one-time install of the `[rerank]` extra — the old watcher has already
 *  stuck its "FlagEmbedding missing" flag and would refuse to rerank forever
 *  without a restart. Best-effort: returns `no-unit-found` quietly if the user
 *  is running the watcher some other way. */
export async function restartWatcher(): Promise<WatcherRestartOutcome> {
  const p = platform();
  if (p === 'darwin') {
    const id = String(process.getuid ? process.getuid() : 0);
    const target = `gui/${id}/${PLIST_NAME.replace(/\.plist$/, '')}`;
    const res = await runCommand('launchctl', ['kickstart', '-k', target], {
      timeoutMs: 20_000,
    });
    if (res.ok) return 'restarted';
    if (/Could not find|No such process|not loaded/i.test(res.stderr + res.stdout)) {
      return 'no-unit-found';
    }
    throw new Error(`launchctl kickstart failed: ${res.stderr || res.stdout}`);
  }
  if (p === 'linux') {
    const res = await runCommand('systemctl', ['--user', 'restart', SERVICE_NAME], {
      timeoutMs: 20_000,
    });
    if (res.ok) return 'restarted';
    if (/not-loaded|not loaded|not found/i.test(res.stderr + res.stdout)) {
      return 'no-unit-found';
    }
    throw new Error(`systemctl --user restart failed: ${res.stderr || res.stdout}`);
  }
  return 'unsupported-platform';
}
