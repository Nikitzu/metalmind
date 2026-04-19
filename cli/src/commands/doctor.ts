import { intro, log, outro } from '@clack/prompts';
import { CONFIG_PATH, readConfig } from '../config.js';

export async function doctor(): Promise<void> {
  intro('metalmind doctor');

  const config = await readConfig();

  if (!config) {
    log.warn(`No config found at ${CONFIG_PATH}`);
    log.info('Run `metalmind init` to perform the interactive setup.');
    outro('Not installed.');
    return;
  }

  log.success(`Config at ${CONFIG_PATH}`);
  log.info(`flavor:        ${config.flavor}`);
  log.info(`vaultPath:     ${config.vaultPath}`);
  log.info(`outputStyle:   ${config.outputStyle.installed}`);
  log.info(`embeddings:    ${config.embeddings.provider}`);
  log.info(`recall.default:${config.recall.defaultTier}`);
  log.info(`mcp:           ${config.mcp.registered.join(', ') || '(none)'}`);
  log.info(`hooks.claude:  ${config.hooks.claudeCode}`);
  log.info(`forge.groups:  ${Object.keys(config.forge.groups).join(', ') || '(none)'}`);

  outro('OK.');
}
