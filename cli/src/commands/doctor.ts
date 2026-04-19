import { intro, log, outro } from '@clack/prompts';
import { CONFIG_PATH, readConfig } from '../config.js';
import { detectPrereqs } from '../install/prereqs.js';

export async function doctor(): Promise<void> {
  intro('metalmind doctor');

  log.step('Prerequisites');
  const prereqs = await detectPrereqs();
  for (const r of prereqs) {
    if (r.ok) {
      log.success(`${r.name.padEnd(14)} ${r.detail}`);
    } else {
      log.error(`${r.name.padEnd(14)} ${r.detail}`);
      if (r.remediation) log.info(`  → ${r.remediation}`);
    }
  }
  const failed = prereqs.filter((r) => !r.ok).length;

  log.step('Config');
  const config = await readConfig();
  if (!config) {
    log.warn(`No config at ${CONFIG_PATH}`);
    log.info('Run `metalmind init` to perform the interactive setup.');
  } else {
    log.success(`Config at ${CONFIG_PATH}`);
    log.info(`flavor:         ${config.flavor}`);
    log.info(`vaultPath:      ${config.vaultPath}`);
    log.info(`outputStyle:    ${config.outputStyle.installed}`);
    log.info(`embeddings:     ${config.embeddings.provider}`);
    log.info(`recall.default: ${config.recall.defaultTier}`);
    log.info(`mcp:            ${config.mcp.registered.join(', ') || '(none)'}`);
    log.info(`hooks.claude:   ${config.hooks.claudeCode}`);
    log.info(`forge.groups:   ${Object.keys(config.forge.groups).join(', ') || '(none)'}`);
  }

  const summary =
    failed === 0 && config
      ? 'All systems nominal.'
      : failed > 0
        ? `${failed} prereq(s) failing — see remediation above.`
        : 'Prereqs ok; no config — run `metalmind init`.';
  outro(summary);

  if (failed > 0) process.exitCode = 1;
}
