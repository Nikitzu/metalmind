import { type ExecaError, execa } from 'execa';

export interface CommandResult {
  stdout: string;
  stderr: string;
  ok: boolean;
  exitCode: number | null;
}

export async function runCommand(
  cmd: string,
  args: string[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<CommandResult> {
  try {
    const result = await execa(cmd, args, {
      timeout: opts.timeoutMs ?? 5000,
      reject: false,
      stripFinalNewline: true,
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      ok: result.exitCode === 0,
      exitCode: result.exitCode ?? null,
    };
  } catch (err) {
    const e = err as ExecaError;
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : String(err),
      ok: false,
      exitCode: typeof e.exitCode === 'number' ? e.exitCode : null,
    };
  }
}
