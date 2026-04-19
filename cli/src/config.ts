import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const CONFIG_DIR = join(homedir(), '.metalmind');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const FlavorSchema = z.enum(['scadrial', 'classic']);
const RecallTierSchema = z.enum(['fast', 'deep', 'expand']);
const EmbeddingsProviderSchema = z.enum(['local', 'ollama', 'custom', 'skip']);
const MemoryRoutingSchema = z.enum(['vault-only', 'both']);

const ForgeGroupSchema = z.object({
  repos: z.array(z.string()),
});

export const CURRENT_CONFIG_VERSION = 1 as const;

export const ConfigSchema = z.object({
  version: z.literal(CURRENT_CONFIG_VERSION),
  flavor: FlavorSchema,
  vaultPath: z.string(),
  graphifyCmd: z.string().default('graphify'),
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
};

function migrate(raw: RawConfig): RawConfig {
  let current = raw;
  const startVersion = typeof current.version === 'number' ? current.version : 0;
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
    const migrated = migrate(parsed);
    return ConfigSchema.parse(migrated);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    throw err;
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
