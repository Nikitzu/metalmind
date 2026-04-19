import { intro, log, outro } from '@clack/prompts';

export async function uninstall(): Promise<void> {
  intro('metalmind uninstall');
  log.warn('Not implemented in slice 1 — scaffold only.');
  log.info(
    'Coming in slice 10: stop services, unload launchd, remove MCP entries, restore output-style.',
  );
  outro('Stub.');
}
