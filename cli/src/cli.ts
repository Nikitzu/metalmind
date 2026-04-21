import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { burn } from './commands/burn.js';
import { doctor } from './commands/doctor.js';
import {
  forgeAdd,
  forgeCaptureSpec,
  forgeCreate,
  forgeDelete,
  forgeList,
  forgeRemove,
  forgeSpecList,
  forgeSpecRemove,
} from './commands/forge.js';
import { init } from './commands/init.js';
import { releaseCheck } from './commands/release-check.js';
import {
  aluminumWipe,
  burnZinc,
  pewterReindex,
  renameSymbol,
  toggleVerbose,
} from './commands/remaining-burns.js';
import {
  scribeArchiveCmd,
  scribeCreateCmd,
  scribeDeleteCmd,
  scribeListCmd,
  scribePatchCmd,
  scribeRenameCmd,
  scribeShowCmd,
  scribeUpdateCmd,
} from './commands/scribe.js';
import { stamp } from './commands/stamp.js';
import { type StoreOptions, store } from './commands/store.js';
import { type TapOptions, tap } from './commands/tap.js';
import { uninstall } from './commands/uninstall.js';

const program = new Command();

program
  .name('metalmind')
  .description('Unified CLI for Obsidian vault, code graph, and cross-repo intelligence.')
  .version(pkg.version);

program
  .command('init')
  .description('Interactive setup wizard (accepts flags for scripted installs)')
  .option('-y, --yes', 'Accept every default (non-interactive)')
  .option('--vault-path <path>', 'Vault path (default ~/Knowledge)')
  .option('--flavor <flavor>', '"scadrial" or "classic"')
  .option('--serena', 'Install Serena')
  .option('--no-serena', 'Skip Serena install')
  .option('--graphify', 'Install graphify')
  .option('--no-graphify', 'Skip graphify install')
  .option('--teams', 'Enable agent teams')
  .option('--no-teams', 'Disable agent teams')
  .option('--memory-routing <mode>', '"vault-only" or "both"')
  .option('--skip-docker', 'Skip Docker stack setup (useful when stack is already running)')
  .option('--skip-watcher', 'Skip watcher plist/service install (CI / test harness only)')
  .action((cmdOpts) => init(cmdOpts));
program
  .command('doctor')
  .description('Diagnose installation state (classic alias for `pulse`)')
  .option('--deep', 'Also probe live services (Docker, Qdrant, Ollama, watcher, stamps)')
  .action((cmdOpts: { deep?: boolean }) => doctor('doctor', { deep: cmdOpts.deep }));
program
  .command('pulse')
  .description('Pulse-check the install — prereqs, config, MCP state (Seeker)')
  .option('--deep', 'Also probe live services (Docker, Qdrant, Ollama, watcher, stamps)')
  .action((cmdOpts: { deep?: boolean }) => doctor('pulse', { deep: cmdOpts.deep }));
program
  .command('uninstall')
  .description('Reversible teardown')
  .option('-y, --yes', 'Non-interactive: accept defaults (keeps volumes, uninstalls vault-rag, leaves Serena/graphify)')
  .option('--purge', 'Also remove Docker volumes (Qdrant data, Ollama models). Only takes effect with --yes or after prompt.')
  .action((cmdOpts: { yes?: boolean; purge?: boolean }) => uninstall(cmdOpts));

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
    .option('-k, --k <n>', 'Limit results to top N', (v) => Number.parseInt(v, 10))
    .option('--json', 'Emit structured JSON (tier, query, text, raw)')
    .option('--verbose', 'Include metadata line (overrides config.verbose)')
    .option('--list-recent <n>', 'List the N most-recently-modified notes (no query needed)', (v) =>
      Number.parseInt(v, 10),
    ) as T;
}

type TapCliOpts = {
  deep?: boolean;
  expand?: boolean;
  k?: number;
  json?: boolean;
  verbose?: boolean;
  listRecent?: number;
};

function normalizeTapOpts(cmdOpts: TapCliOpts): TapOptions {
  return {
    deep: cmdOpts.deep,
    expand: cmdOpts.expand,
    k: cmdOpts.k,
    json: cmdOpts.json,
    verbose: cmdOpts.verbose,
    listRecent: cmdOpts.listRecent,
  };
}

const tapCmd = program
  .command('tap')
  .description('Feruchemy — withdraw state. Currently: `tap copper <query>` → vault.');
attachTapFlags(
  tapCmd
    .command('copper [query]')
    .description('Recall notes from your coppermind (the Obsidian vault)'),
).action((query: string | undefined, cmdOpts: TapCliOpts) => tap(query, normalizeTapOpts(cmdOpts)));

attachTapFlags(
  program.command('recall [query]').description('Classic alias: recall notes from the vault'),
).action((query: string | undefined, cmdOpts: TapCliOpts) => tap(query, normalizeTapOpts(cmdOpts)));

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
  parent
    .command('capture-spec <repo> <source>')
    .description(
      'Capture an OpenAPI spec (URL or file) into the metalmind spec shelf for cross-repo route matching. Does not touch the target repo.',
    )
    .option('--as <slug>', 'Override shelf slug (defaults to basename(repo))')
    .action((repo: string, source: string, cmdOpts: { as?: string }) =>
      forgeCaptureSpec(repo, source, { as: cmdOpts.as }),
    );
  parent
    .command('spec-list')
    .description('List OpenAPI specs on the shelf')
    .action(forgeSpecList);
  parent
    .command('spec-remove <slug>')
    .description('Remove an OpenAPI spec from the shelf by slug')
    .action(forgeSpecRemove);
}

const forgeCmd = program.command('forge').description('Cross-repo graph groups');
attachForgeSubcommands(forgeCmd);

const groupCmd = program.command('group').description('Classic alias: cross-repo graph groups');
attachForgeSubcommands(groupCmd);

function attachScribeSubcommands(parent: Command): void {
  parent
    .command('create <title>')
    .description('Create a vault note with frontmatter + MOC linking. Body read from stdin.')
    .requiredOption(
      '--kind <kind>',
      'plan | learning | work | daily | moc | inbox',
    )
    .option('--project <slug>', 'Project slug (drives MOC linking via frontmatter)')
    .option('--tags <csv>', 'Comma-separated tags')
    .option('--slug <slug>', 'Override derived slug')
    .option('--body <body>', 'Body inline (otherwise read from stdin)')
    .option('--no-moc', 'Skip appending a link to the project MOC')
    .option('--dry-run', 'Preview only')
    .action((title: string, cmdOpts) => scribeCreateCmd(title, cmdOpts));
  parent
    .command('update <note>')
    .description('Append body to an existing note and bump updated:. Accepts kind:slug shortcut.')
    .option('--body <body>', 'Body inline (otherwise read from stdin)')
    .option('--dry-run', 'Preview only')
    .action((note: string, cmdOpts) => scribeUpdateCmd(note, cmdOpts));
  parent
    .command('patch <note>')
    .description('Replace one ## section in an existing note.')
    .requiredOption('--section <heading>', 'Section heading without the ## prefix')
    .option('--body <body>', 'Body inline (otherwise read from stdin)')
    .option(
      '--occurrence <n>',
      '1-indexed occurrence when section appears multiple times',
    )
    .option('--dry-run', 'Preview only')
    .action((note: string, cmdOpts) => scribePatchCmd(note, cmdOpts));
  parent
    .command('delete <note>')
    .description('Soft-delete (move to .trash/). --hard to actually remove.')
    .option('--hard', 'Hard delete instead of moving to .trash/')
    .option('--dry-run', 'Preview only')
    .action((note: string, cmdOpts) => scribeDeleteCmd(note, cmdOpts));
  parent
    .command('archive <note>')
    .description('Move to Archive/ and set status: archived. MOC links preserved.')
    .option('--dry-run', 'Preview only')
    .action((note: string, cmdOpts) => scribeArchiveCmd(note, cmdOpts));
  parent
    .command('list')
    .description('List notes, optionally filtered by project or kind.')
    .option('--project <slug>', 'Filter by project frontmatter')
    .option('--kind <kind>', 'Filter by note kind')
    .action((cmdOpts) => scribeListCmd(cmdOpts));
  parent
    .command('show <note>')
    .description('Print a note to stdout. Accepts kind:slug shortcut.')
    .action((note: string) => scribeShowCmd(note));
  parent
    .command('rename <from> <to>')
    .description('Rename a note and rewrite all wikilink backlinks across the vault.')
    .option('--dry-run', 'Preview changes without writing')
    .action((from: string, to: string, cmdOpts: { dryRun?: boolean }) =>
      scribeRenameCmd(from, to, cmdOpts),
    );
}

const scribeCmd = program
  .command('scribe')
  .description('Write, update, patch, delete, archive vault notes');
attachScribeSubcommands(scribeCmd);

const noteCmd = program.command('note').description('Classic alias: vault note CRUD');
attachScribeSubcommands(noteCmd);

program
  .command('release-check')
  .description(
    'Preflight before tagging a release. Verifies working tree, branch, global install sync with HEAD, tests, build, doctor, and stamped CLAUDE.md block.',
  )
  .option('--skip-tests', 'Skip the test suite (not recommended)')
  .option('--skip-build', 'Skip the build step')
  .action((cmdOpts: { skipTests?: boolean; skipBuild?: boolean }) => releaseCheck(cmdOpts));

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
  .option('-y, --yes', 'Non-interactive: accept defaults')
  .option('--purge', 'Also remove Docker volumes (with --yes)')
  .action((cmdOpts: { yes?: boolean; purge?: boolean }) => aluminumWipe(cmdOpts));

burnCmd
  .command('brass')
  .description('Burn Brass (Soother) — smooth out drift, re-imprint metalmind managed files')
  .option('--skip-watcher', 'Skip refreshing the watcher unit file')
  .action((cmdOpts: { skipWatcher?: boolean }) => stamp({ skipWatcher: cmdOpts.skipWatcher }));

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

program
  .command('wipe')
  .description('Classic alias: uninstall metalmind')
  .option('-y, --yes', 'Non-interactive: accept defaults')
  .option('--purge', 'Also remove Docker volumes (with --yes)')
  .action((cmdOpts: { yes?: boolean; purge?: boolean }) => aluminumWipe(cmdOpts));

program
  .command('stamp')
  .description('Classic alias: smooth out drift, re-imprint metalmind managed files')
  .option('--skip-watcher', 'Skip refreshing the watcher unit file')
  .action((cmdOpts: { skipWatcher?: boolean }) => stamp({ skipWatcher: cmdOpts.skipWatcher }));

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`metalmind: ${message}\n`);
  process.exit(1);
});
