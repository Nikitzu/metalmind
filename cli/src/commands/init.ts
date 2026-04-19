import { log } from '@clack/prompts';
import { runWizard } from '../install/wizard.js';

export async function init(): Promise<void> {
  try {
    await runWizard();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`init failed: ${message}`);
    process.exitCode = 1;
  }
}
