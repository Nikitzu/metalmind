import { Command } from 'commander';
import { burn } from './commands/burn.js';
import { doctor } from './commands/doctor.js';
import { forgeAdd, forgeCreate, forgeDelete, forgeList, forgeRemove } from './commands/forge.js';
import { init } from './commands/init.js';
import {
  aluminumWipe,
  burnZinc,
  pewterReindex,
  renameSymbol,
  toggleVerbose,
} from './commands/remaining-burns.js';
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

const burnCmd = program
  .command('burn')
  .description('Allomancy — burn a metal, take an action. bronze/iron live here.');

burnCmd
  .command('bronze <query>')
  .description('Burn Bronze (Seeker) — query the code graph for structure / concepts')
  .option('--yes', 'Skip the index prompt; assume yes if no graph exists')
  .option('--forge <name>', 'Query across all repos in the named forge')
  .action((query: string, cmdOpts: { yes?: boolean; forge?: string }) =>
    burn({ metal: 'bronze', input: query, assumeYes: cmdOpts.yes, forge: cmdOpts.forge }),
  );

burnCmd
  .command('iron <symbol>')
  .description('Burn Iron — pull a symbol and its neighbors out of the graph')
  .option('--yes', 'Skip the index prompt; assume yes if no graph exists')
  .option('--forge <name>', 'Query across all repos in the named forge')
  .action((symbol: string, cmdOpts: { yes?: boolean; forge?: string }) =>
    burn({ metal: 'iron', input: symbol, assumeYes: cmdOpts.yes, forge: cmdOpts.forge }),
  );

program
  .command('graph <query>')
  .description('Classic alias: query the code graph')
  .option('--yes', 'Skip the index prompt')
  .option('--group <name>', 'Query across all repos in the named group')
  .action((query: string, cmdOpts: { yes?: boolean; group?: string }) =>
    burn({ metal: 'bronze', input: query, assumeYes: cmdOpts.yes, forge: cmdOpts.group }),
  );

program
  .command('symbol <symbol>')
  .description('Classic alias: pull a symbol and its neighbors')
  .option('--yes', 'Skip the index prompt')
  .option('--group <name>', 'Query across all repos in the named group')
  .action((symbol: string, cmdOpts: { yes?: boolean; group?: string }) =>
    burn({ metal: 'iron', input: symbol, assumeYes: cmdOpts.yes, forge: cmdOpts.group }),
  );

function attachForgeSubcommands(parent: Command): void {
  parent.command('create <name>').description('Create a new forge').action(forgeCreate);
  parent.command('delete <name>').description('Delete a forge').action(forgeDelete);
  parent.command('add <name> <repo>').description('Add a repo path to the forge').action(forgeAdd);
  parent
    .command('remove <name> <repo>')
    .description('Remove a repo path from the forge')
    .action(forgeRemove);
  parent.command('list').description('List all forges').action(forgeList);
}

const forgeCmd = program.command('forge').description('Cross-repo graph groups');
attachForgeSubcommands(forgeCmd);

const groupCmd = program.command('group').description('Classic alias: cross-repo graph groups');
attachForgeSubcommands(groupCmd);

burnCmd
  .command('steel <old> <new>')
  .description('Burn Steel — rename a symbol via Serena')
  .action(renameSymbol);

burnCmd
  .command('zinc <bug>')
  .description('Burn Zinc (Rioter) — dispatch team-debug via Claude Code')
  .action(burnZinc);

burnCmd
  .command('tin')
  .description('Burn Tin — toggle verbose output')
  .option('--on', 'Force verbose on')
  .option('--off', 'Force verbose off')
  .action((cmdOpts: { on?: boolean; off?: boolean }) => {
    const state = cmdOpts.on ? true : cmdOpts.off ? false : undefined;
    return toggleVerbose(state);
  });

burnCmd
  .command('pewter')
  .description('Burn Pewter — force rebuild the code graph for the current repo')
  .action(pewterReindex);

burnCmd
  .command('aluminum')
  .description('Burn Aluminum — wipe metalmind install (alias for uninstall)')
  .action(aluminumWipe);

program
  .command('rename <old> <new>')
  .description('Classic alias: rename a symbol via Serena')
  .action(renameSymbol);

program
  .command('debug <bug>')
  .description('Classic alias: dispatch team-debug via Claude Code')
  .action(burnZinc);

program
  .command('verbose')
  .description('Classic alias: toggle verbose output')
  .option('--on', 'Force verbose on')
  .option('--off', 'Force verbose off')
  .action((cmdOpts: { on?: boolean; off?: boolean }) => {
    const state = cmdOpts.on ? true : cmdOpts.off ? false : undefined;
    return toggleVerbose(state);
  });

program
  .command('reindex')
  .description('Classic alias: rebuild code graph for current repo')
  .action(pewterReindex);

program.command('wipe').description('Classic alias: uninstall metalmind').action(aluminumWipe);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`metalmind: ${message}\n`);
  process.exit(1);
});
