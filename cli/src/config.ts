import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const CONFIG_DIR = join(homedir(), '.metalmind');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const FlavorSchema = z.enum(['scadrial', 'classic']);
const RecallTierSchema = z.enum(['fast', 'deep', 'expand']);
const EmbeddingsProviderSchema = z.enum(['local', 'skip']);
const MemoryRoutingSchema = z.enum(['vault-only', 'both']);
const HostSchema = z.enum(['claude', 'codex', 'cursor']);

export type MetalmindHost = z.infer<typeof HostSchema>;

const ForgeGroupSchema = z.object({
  repos: z.array(z.string()),
});

export const CURRENT_CONFIG_VERSION = 3 as const;

export const ConfigSchema = z.object({
  version: z.literal(CURRENT_CONFIG_VERSION),
  flavor: FlavorSchema,
  vaultPath: z.string(),
  outputStyle: z.object({
    installed: z.string().nullable(),
    priorValue: z.string().nullable(),
  }),
  embeddings: z.object({
    provider: EmbeddingsProviderSchema,
    baseURL: z.string().nullable(),
  }),
  recall: z.object({
    defaultTier: RecallTierSchema,
    httpEndpoint: z.string().nullable().default(null),
  }),
  verbose: z.boolean().default(false),
  mcp: z.object({
    registered: z.array(z.string()),
  }),
  hooks: z.object({
    claudeCode: z.boolean(),
  }),
  memoryRouting: MemoryRoutingSchema.default('vault-only'),
  forge: z.object({
    groups: z.record(z.string(), ForgeGroupSchema),
  }),
  skills: z
    .object({
      eodHook: z.boolean().default(true),
      notifications: z.boolean().default(true),
    })
    .default({ eodHook: true, notifications: true }),
  // Backwards-compat: configs predating v0.8.0 (Codex host integration)
  // had no notion of `hosts` because Claude Code was the only target.
  // .default(['claude']) means an existing config gets ['claude'] on read,
  // preserving v0.7.x behavior; only re-stamping after init/stamp can add 'codex'.
  hosts: z.array(HostSchema).nonempty().default(['claude']),
});

export type Config = z.infer<typeof ConfigSchema>;

// Migrations run in ascending order. Each migration takes raw JSON and bumps
// it to the next version. Only one exists today (v1 is current), but the
// scaffold is here so adding v2 is a drop-in: register a new migration,
// bump CURRENT_CONFIG_VERSION, update the schema.
type RawConfig = Record<string, unknown>;
type Migration = (raw: RawConfig) => RawConfig;

const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: not needed (v1 is the first versioned schema)
  1: (raw) => {
    const { graphifyCmd: _dropped, ...rest } = raw;
    const mcp = rest.mcp as { registered?: unknown } | undefined;
    const registered = Array.isArray(mcp?.registered)
      ? mcp.registered.filter((name) => name !== 'graphify')
      : [];
    const hooks = rest.hooks as Record<string, unknown> | undefined;
    return {
      ...rest,
      version: 2,
      mcp: { ...(mcp ?? {}), registered },
      hooks: { ...(hooks ?? {}), claudeCode: false },
    };
  },
  2: (raw) => {
    const embeddings = raw.embeddings as { provider?: unknown; baseURL?: unknown } | undefined;
    const provider = embeddings?.provider;
    const stillValid = provider === 'local' || provider === 'skip';
    return {
      ...raw,
      version: 3,
      embeddings: {
        provider: stillValid ? provider : 'local',
        baseURL: stillValid ? (embeddings?.baseURL ?? null) : null,
      },
    };
  },
};

function migrate(raw: RawConfig): RawConfig {
  let current = raw;
  const startVersion = typeof current.version === 'number' ? current.version : 0;
  if (startVersion > CURRENT_CONFIG_VERSION) {
    throw new Error(
      `~/.metalmind/config.json is version ${startVersion}, but this metalmind only understands ${CURRENT_CONFIG_VERSION}. ` +
        'A newer metalmind wrote it. Migrations only run forward, so upgrade rather than downgrade: ' +
        'pnpm add -g metalmind@latest (or npm i -g metalmind@latest).',
    );
  }
  for (let v = startVersion; v < CURRENT_CONFIG_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (!migration) {
      throw new Error(
        `No migration from config v${v} to v${v + 1}. Re-run \`metalmind init\` to rebuild the config.`,
      );
    }
    current = migration(current);
  }
  return current;
}

export async function readConfig(path: string = CONFIG_PATH): Promise<Config | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as RawConfig;
    const startVersion = typeof parsed.version === 'number' ? parsed.version : 0;
    const migrated = migrate(parsed);
    const config = ConfigSchema.parse(migrated);
    if (startVersion < CURRENT_CONFIG_VERSION) {
      await persistConfig(config, path);
    }
    return config;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function persistConfig(config: Config, path: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(tmpPath, path);
  } catch {
    return;
  }
}

export async function writeConfig(config: Config): Promise<void> {
  ConfigSchema.parse(config);
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  const tmpPath = `${CONFIG_PATH}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(tmpPath, CONFIG_PATH);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
