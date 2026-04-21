import { log } from '@clack/prompts';
import { readConfig } from '../config.js';
import {
  KIND_DIRS,
  scribeArchive,
  scribeCreate,
  scribeDelete,
  scribeList,
  scribePatch,
  scribeShow,
  scribeUpdate,
  type ScribeKind,
  type ScribeOpts,
} from '../scribe/scribe.js';

function fail(message: string): void {
  log.error(message);
  process.exitCode = 1;
}

async function ctx(): Promise<ScribeOpts> {
  const cfg = await readConfig();
  if (!cfg) throw new Error('metalmind not initialized — run `metalmind init` first');
  return { vaultRoot: cfg.vaultPath };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function assertKind(kind: string): ScribeKind {
  if (!(kind in KIND_DIRS)) {
    throw new Error(`invalid --kind '${kind}' (valid: ${Object.keys(KIND_DIRS).join(', ')})`);
  }
  return kind as ScribeKind;
}

export async function scribeCreateCmd(
  title: string,
  opts: {
    kind: string;
    project?: string;
    tags?: string;
    slug?: string;
    body?: string;
    moc?: boolean;
    dryRun?: boolean;
  },
): Promise<void> {
  try {
    const body = opts.body ?? (await readStdin());
    const res = await scribeCreate(
      {
        kind: assertKind(opts.kind),
        title,
        body,
        project: opts.project,
        tags: opts.tags?.split(',').map((t) => t.trim()).filter(Boolean),
        slug: opts.slug,
        moc: opts.moc,
        dryRun: opts.dryRun,
      },
      await ctx(),
    );
    log.success(`${opts.dryRun ? 'would create' : 'created'} ${res.relPath}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function scribeUpdateCmd(
  notePath: string,
  opts: { body?: string; dryRun?: boolean },
): Promise<void> {
  try {
    const body = opts.body ?? (await readStdin());
    if (!body.trim()) throw new Error('empty body — pipe content on stdin or pass --body');
    const res = await scribeUpdate(notePath, body, await ctx(), { dryRun: opts.dryRun });
    log.success(`${opts.dryRun ? 'would update' : 'updated'} ${res.path}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function scribePatchCmd(
  notePath: string,
  opts: { section: string; body?: string; occurrence?: string; dryRun?: boolean },
): Promise<void> {
  try {
    const body = opts.body ?? (await readStdin());
    if (!body.trim()) throw new Error('empty body — pipe content on stdin or pass --body');
    const occurrence = opts.occurrence ? Number.parseInt(opts.occurrence, 10) : undefined;
    const res = await scribePatch(
      notePath,
      { section: opts.section, body, occurrence, dryRun: opts.dryRun },
      await ctx(),
    );
    log.success(`${opts.dryRun ? 'would patch' : 'patched'} ## ${opts.section} in ${res.path}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function scribeDeleteCmd(
  notePath: string,
  opts: { hard?: boolean; dryRun?: boolean },
): Promise<void> {
  try {
    const res = await scribeDelete(notePath, await ctx(), {
      hard: opts.hard,
      dryRun: opts.dryRun,
    });
    if (opts.hard) log.success(`${opts.dryRun ? 'would hard-delete' : 'hard-deleted'} ${res.path}`);
    else
      log.success(
        `${opts.dryRun ? 'would soft-delete' : 'soft-deleted'} ${res.path}${res.to ? ` → ${res.to}` : ''}`,
      );
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function scribeArchiveCmd(
  notePath: string,
  opts: { dryRun?: boolean },
): Promise<void> {
  try {
    const res = await scribeArchive(notePath, await ctx(), { dryRun: opts.dryRun });
    log.success(`${opts.dryRun ? 'would archive' : 'archived'} ${res.path} → ${res.to}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function scribeListCmd(opts: { project?: string; kind?: string }): Promise<void> {
  try {
    const entries = await scribeList(await ctx(), {
      project: opts.project,
      kind: opts.kind ? assertKind(opts.kind) : undefined,
    });
    if (entries.length === 0) {
      log.info('no notes match');
      return;
    }
    for (const e of entries) {
      log.info(
        `  ${e.relPath}${e.title ? ` — ${e.title}` : ''}${e.project ? ` [${e.project}]` : ''}${e.status && e.status !== 'active' ? ` (${e.status})` : ''}`,
      );
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function scribeShowCmd(notePath: string): Promise<void> {
  try {
    const content = await scribeShow(notePath, await ctx());
    process.stdout.write(content);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
