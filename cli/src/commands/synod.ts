import { log } from '@clack/prompts';
import { readConfig } from '../config.js';
import { runCommand } from '../util/exec.js';

// Convene the synod skill from the shell. Mirrors burnZinc - shells out to
// `claude -p` so the conversation runs in a real Claude Code session and the
// skill's parallel-subagent orchestration works. Streams output live.
export async function synod(question: string | undefined): Promise<void> {
  if (!question?.trim()) {
    log.error('Usage: metalmind synod "<question>"');
    process.exitCode = 1;
    return;
  }

  const config = await readConfig();
  if (!config) {
    log.error('No metalmind config. Run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }

  const claudeAvailable = await runCommand('claude', ['--version']);
  if (!claudeAvailable.ok) {
    log.error('claude CLI not found on PATH. Open Claude Code manually and paste:');
    process.stdout.write(`\nConvene the synod on: ${question}\n\n`);
    process.exitCode = 1;
    return;
  }

  const res = await runCommand('claude', ['-p', `Convene the synod on: ${question}`], {
    timeoutMs: 0,
    inheritStdio: true,
  });
  if (!res.ok) {
    log.error(`claude exited ${res.exitCode ?? 'unknown'}`);
    process.exitCode = res.exitCode ?? 1;
  }
}
