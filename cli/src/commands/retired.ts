import { log } from '@clack/prompts';

export interface RetiredCommand {
  replacement: string;
  reason: string;
}

export const RETIRED_COMMANDS: Record<string, RetiredCommand> = {
  'burn bronze': {
    replacement: 'codegraph explore "<query>"',
    reason: 'within-repo code graph queries moved to codegraph',
  },
  'burn iron': {
    replacement: 'codegraph node <symbol>',
    reason: 'within-repo symbol lookup moved to codegraph',
  },
  'burn pewter': {
    replacement: 'codegraph index',
    reason: 'within-repo indexing moved to codegraph',
  },
  graph: {
    replacement: 'codegraph explore "<query>"',
    reason: 'within-repo code graph queries moved to codegraph',
  },
  symbol: {
    replacement: 'codegraph node <symbol>',
    reason: 'within-repo symbol lookup moved to codegraph',
  },
  reindex: {
    replacement: 'codegraph index',
    reason: 'within-repo indexing moved to codegraph',
  },
};

export function retired(name: string): void {
  const entry = RETIRED_COMMANDS[name];
  if (!entry) {
    log.error(`\`metalmind ${name}\` has been removed.`);
    process.exitCode = 1;
    return;
  }
  log.error(`\`metalmind ${name}\` has been removed - ${entry.reason}.`);
  process.stdout.write(
    [
      '',
      `  Use:  ${entry.replacement}`,
      '',
      '  codegraph is a separate local tool. Install it with:',
      '    curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh',
      '',
      '  Cross-repo queries stay in metalmind - `metalmind forge` no longer',
      '  needs graphify and reads your source directly.',
      '',
      '  Run `metalmind doctor` to clear any leftover graphify install.',
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
}
