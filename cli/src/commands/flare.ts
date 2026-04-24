import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { log } from '@clack/prompts';

function fail(message: string): void {
  log.error(message);
  process.exitCode = 1;
}

function requireMac(): void {
  if (platform() !== 'darwin') {
    throw new Error('flare is macOS-only (uses AppleScript). Linux/Windows support: planned.');
  }
}

function osascript(script: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-e', script]);
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
    child.on('error', (err) => resolve({ code: 1, stderr: String(err) }));
  });
}

function appleScriptEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function flareBanner(title: string, text: string): Promise<void> {
  try {
    requireMac();
    const script = `display notification "${appleScriptEscape(text)}" with title "${appleScriptEscape(title)}"`;
    const { code, stderr } = await osascript(script);
    if (code !== 0) throw new Error(stderr.trim() || `osascript exited ${code}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function flareDialog(text: string): Promise<void> {
  try {
    requireMac();
    const script = `display dialog "${appleScriptEscape(text)}" buttons {"OK"} default button "OK"`;
    const { code, stderr } = await osascript(script);
    if (code !== 0) throw new Error(stderr.trim() || `osascript exited ${code}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function flareSticky(text: string): Promise<void> {
  try {
    requireMac();
    const escaped = appleScriptEscape(text);
    const script = [
      `set the clipboard to "${escaped}"`,
      'tell application "Stickies" to activate',
      'delay 0.3',
      'tell application "System Events"',
      '  keystroke "n" using command down',
      '  delay 0.3',
      '  keystroke "v" using command down',
      'end tell',
    ].join('\n');
    const { code, stderr } = await osascript(script);
    if (code !== 0) throw new Error(stderr.trim() || `osascript exited ${code}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
