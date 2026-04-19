import { intro, log, outro } from '@clack/prompts';

export async function init(): Promise<void> {
  intro('metalmind init');
  log.warn('Not implemented in slice 1 — scaffold only.');
  log.info(
    'Coming in slices 2–10: prereq checks, vault setup, docker stack, launchd, MCP registration.',
  );
  outro('Stub.');
}
