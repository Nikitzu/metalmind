import { Command } from 'commander';
import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { uninstall } from './commands/uninstall.js';

const program = new Command();

program
  .name('metalmind')
  .description('Unified CLI for Obsidian vault, code graph, and cross-repo intelligence.')
  .version('0.0.1');

program.command('init').description('Interactive setup wizard').action(init);
program.command('doctor').description('Diagnose installation state').action(doctor);
program.command('uninstall').description('Reversible teardown').action(uninstall);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`metalmind: ${message}\n`);
  process.exit(1);
});
