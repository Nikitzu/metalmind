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
  opts: { timeoutMs?: number; inheritStdio?: boolean } = {},
): Promise<CommandResult> {
  try {
    const result = await execa(cmd, args, {
      // 0 disables execa's timeout; any other falsy falls back to the 5s default.
      timeout: opts.timeoutMs === 0 ? undefined : (opts.timeoutMs ?? 5000),
      reject: false,
      stripFinalNewline: true,
      // When the caller wants live output (long-running claude sessions etc.),
      // inherit stdio so the user sees progress + can Ctrl-C cleanly.
      ...(opts.inheritStdio ? { stdio: 'inherit' as const } : {}),
    });
    return {
      stdout: (result.stdout as string | undefined) ?? '',
      stderr: (result.stderr as string | undefined) ?? '',
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
