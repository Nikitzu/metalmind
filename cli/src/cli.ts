import { Command } from 'commander';
import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { type StoreOptions, store } from './commands/store.js';
import { type TapOptions, tap } from './commands/tap.js';
import { uninstall } from './commands/uninstall.js';

const program = new Command();

program
  .name('metalmind')
  .description('Unified CLI for Obsidian vault, code graph, and cross-repo intelligence.')
  .version('0.0.1');

program.command('init').description('Interactive setup wizard').action(init);
program.command('doctor').description('Diagnose installation state').action(doctor);
program.command('uninstall').description('Reversible teardown').action(uninstall);

function attachStoreFlags<T extends Command>(cmd: T): T {
  return cmd
    .option('-t, --title <title>', 'Override inferred title')
    .option('--tag <tag...>', 'Frontmatter tag (repeatable)')
    .option('-p, --project <project>', 'Frontmatter project') as T;
}

const storeCmd = program
  .command('store')
  .description('Feruchemy — deposit state. Currently: `store copper <insight>` → vault.')
  .addHelpText('after', '\nExample: metalmind store copper "auth rewrite decision"');
attachStoreFlags(
  storeCmd
    .command('copper <insight>')
    .description('Store an insight in your coppermind (the Obsidian vault)'),
).action((insight: string, cmdOpts: { title?: string; tag?: string[]; project?: string }) => {
  const opts: StoreOptions = {
    title: cmdOpts.title,
    tags: cmdOpts.tag,
    project: cmdOpts.project,
  };
  return store(insight, opts);
});

attachStoreFlags(
  program.command('save <insight>').description('Classic alias: save an insight to the vault'),
).action((insight: string, cmdOpts: { title?: string; tag?: string[]; project?: string }) => {
  const opts: StoreOptions = {
    title: cmdOpts.title,
    tags: cmdOpts.tag,
    project: cmdOpts.project,
  };
  return store(insight, opts);
});

function attachTapFlags<T extends Command>(cmd: T): T {
  return cmd
    .option('--deep', 'Search + related_notes on top hit')
    .option('--expand', 'expand_search: hits + linked context in one call')
    .option('-k, --k <n>', 'Limit results to top N', (v) => Number.parseInt(v, 10)) as T;
}

const tapCmd = program
  .command('tap')
  .description('Feruchemy — withdraw state. Currently: `tap copper <query>` → vault.');
attachTapFlags(
  tapCmd
    .command('copper <query>')
    .description('Recall notes from your coppermind (the Obsidian vault)'),
).action((query: string, cmdOpts: { deep?: boolean; expand?: boolean; k?: number }) => {
  const opts: TapOptions = {
    deep: cmdOpts.deep,
    expand: cmdOpts.expand,
    k: cmdOpts.k,
  };
  return tap(query, opts);
});

attachTapFlags(
  program.command('recall <query>').description('Classic alias: recall notes from the vault'),
).action((query: string, cmdOpts: { deep?: boolean; expand?: boolean; k?: number }) => {
  const opts: TapOptions = {
    deep: cmdOpts.deep,
    expand: cmdOpts.expand,
    k: cmdOpts.k,
  };
  return tap(query, opts);
});

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`metalmind: ${message}\n`);
  process.exit(1);
});
