import { log } from '@clack/prompts';
import { readConfig, writeConfig } from '../config.js';
import {
  type JudgeConfig,
  KEYCHAIN_SERVICE,
  type KeySource,
  PASS_ENTRY,
  resolveJudgeKey,
} from '../judge/client.js';

export function renderJudgeStatus(
  cfg: JudgeConfig,
  key: { key: string | null; source: KeySource },
): string {
  const keyLine =
    key.source === 'env'
      ? 'key: env (TYPESAFE_API_KEY)'
      : key.source === 'keychain'
        ? `key: keychain (${KEYCHAIN_SERVICE})`
        : key.source === 'pass'
          ? `key: pass (${PASS_ENTRY})`
          : process.platform === 'darwin'
            ? `key: none (set TYPESAFE_API_KEY or add a Keychain item with service ${KEYCHAIN_SERVICE})`
            : `key: none (set TYPESAFE_API_KEY or pass insert ${PASS_ENTRY})`;
  const lines = [`enabled: ${cfg.enabled ? 'yes' : 'no'}`, keyLine, `model: ${cfg.model}`];
  if (!cfg.enabled) lines.push('turn on with: metalmind judge enable');
  return lines.join('\n');
}

export async function judgeStatusCmd(): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) {
    log.error('No metalmind config. Run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${renderJudgeStatus(cfg.judge, await resolveJudgeKey())}\n`);
}

export async function judgeSetEnabledCmd(enabled: boolean): Promise<void> {
  const cfg = await readConfig();
  if (!cfg) {
    log.error('No metalmind config. Run `metalmind init` first.');
    process.exitCode = 1;
    return;
  }
  await writeConfig({ ...cfg, judge: { ...cfg.judge, enabled } });
  log.success(`judge ${enabled ? 'enabled' : 'disabled'}`);
}
