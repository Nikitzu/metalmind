import { spawn } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { log } from '@clack/prompts';

const LABEL_PREFIX = 'com.metalmind.routine';
const PLIST_DIR = join(homedir(), 'Library', 'LaunchAgents');

function fail(message: string): void {
  log.error(message);
  process.exitCode = 1;
}

function requireMac(): void {
  if (platform() !== 'darwin') {
    throw new Error('routine is macOS-only (uses launchd). Linux systemd support: planned.');
  }
}

function plistPath(name: string): string {
  return join(PLIST_DIR, `${LABEL_PREFIX}.${name}.plist`);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function launchctl(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('launchctl', args);
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
    child.on('error', (err) => resolve({ code: 1, stderr: String(err) }));
  });
}

interface EodOpts {
  hour: number;
  minute: number;
  metalmindBin: string;
  logDir: string;
}

export function renderEodPlist(opts: EodOpts): string {
  const calendar = [1, 2, 3, 4, 5]
    .map(
      (d) =>
        `    <dict><key>Weekday</key><integer>${d}</integer><key>Hour</key><integer>${opts.hour}</integer><key>Minute</key><integer>${opts.minute}</integer></dict>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL_PREFIX}.eod</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>TODAY=$(date +%Y-%m-%d); ${opts.metalmindBin} atium new --date next-workday --from "$TODAY" 2&gt;&amp;1 || true; ${opts.metalmindBin} gold "daily:$TODAY" 2&gt;&amp;1 || true</string>
  </array>

  <key>StartCalendarInterval</key>
  <array>
${calendar}
  </array>

  <key>StandardOutPath</key>
  <string>${opts.logDir}/metalmind-eod.log</string>
  <key>StandardErrorPath</key>
  <string>${opts.logDir}/metalmind-eod.err</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
}

async function resolveMetalmindBin(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('which', ['metalmind']);
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('close', () => resolve(out.trim() || 'metalmind'));
    child.on('error', () => resolve('metalmind'));
  });
}

export async function routineInstallEodCmd(opts: { time?: string }): Promise<void> {
  try {
    requireMac();
    const [hStr, mStr] = (opts.time ?? '17:30').split(':');
    const hour = Number.parseInt(hStr ?? '17', 10);
    const minute = Number.parseInt(mStr ?? '30', 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
      throw new Error(`invalid --time hour '${hStr}' (expected 0–23)`);
    }
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
      throw new Error(`invalid --time minute '${mStr}' (expected 0–59)`);
    }

    const metalmindBin = await resolveMetalmindBin();
    const logDir = join(homedir(), 'Library', 'Logs');
    await mkdir(logDir, { recursive: true });
    await mkdir(PLIST_DIR, { recursive: true });

    const target = plistPath('eod');
    const body = renderEodPlist({ hour, minute, metalmindBin, logDir });
    await writeFile(target, body, 'utf8');

    if (await fileExists(target)) await launchctl(['unload', target]);
    const { code, stderr } = await launchctl(['load', target]);
    if (code !== 0) throw new Error(stderr.trim() || `launchctl load exited ${code}`);

    log.success(
      `installed ${LABEL_PREFIX}.eod at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} Mon–Fri`,
    );
    log.info(`  plist: ${target}`);
    log.info(`  logs:  ${logDir}/metalmind-eod.{log,err}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function routineRemoveEodCmd(): Promise<void> {
  try {
    requireMac();
    const target = plistPath('eod');
    if (!(await fileExists(target))) {
      log.info('no metalmind eod routine installed');
      return;
    }
    await launchctl(['unload', target]);
    await rm(target);
    log.success(`removed ${LABEL_PREFIX}.eod`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
