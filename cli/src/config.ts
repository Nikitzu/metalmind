import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const CONFIG_DIR = join(homedir(), '.metalmind');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const FlavorSchema = z.enum(['scadrial', 'classic']);
const RecallTierSchema = z.enum(['fast', 'deep', 'expand']);
const EmbeddingsProviderSchema = z.enum(['local', 'ollama', 'custom', 'skip']);

const ForgeGroupSchema = z.object({
  repos: z.array(z.string()),
});

export const ConfigSchema = z.object({
  version: z.literal(1),
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
  }),
  verbose: z.boolean().default(false),
  mcp: z.object({
    registered: z.array(z.string()),
  }),
  hooks: z.object({
    claudeCode: z.boolean(),
  }),
  forge: z.object({
    groups: z.record(z.string(), ForgeGroupSchema),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export async function readConfig(): Promise<Config | null> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return ConfigSchema.parse(JSON.parse(raw));
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
