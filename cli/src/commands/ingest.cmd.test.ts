import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logs = vi.hoisted(() => ({
  info: [] as string[],
  success: [] as string[],
  warn: [] as string[],
  error: [] as string[],
}));

vi.mock('@clack/prompts', () => ({
  log: {
    info: (m: string) => logs.info.push(m),
    success: (m: string) => logs.success.push(m),
    warn: (m: string) => logs.warn.push(m),
    error: (m: string) => logs.error.push(m),
  },
}));

const readConfig = vi.hoisted(() => vi.fn());
vi.mock('../config.js', () => ({ readConfig }));

describe('ingestAutoMemoryCmd', () => {
  let vault: string;
  let projects: string;

  beforeEach(async () => {
    for (const k of Object.keys(logs) as Array<keyof typeof logs>) logs[k].length = 0;
    vault = await mkdtemp(join(tmpdir(), 'mm-cmd-vault-'));
    projects = await mkdtemp(join(tmpdir(), 'mm-cmd-projects-'));
    readConfig.mockResolvedValue({ vaultPath: vault });
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
    await rm(projects, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('reports counts and the imported note', async () => {
    const mem = join(projects, '-proj', 'memory');
    await mkdir(mem, { recursive: true });
    await writeFile(join(mem, 'topic.md'), 'wisdom\n');

    const { ingestAutoMemoryCmd } = await import('./ingest.js');
    await ingestAutoMemoryCmd({ projectsDir: projects });

    expect(logs.info.join('\n')).toContain('1 created, 0 updated, 0 skipped, 0 conflicts');
    expect(logs.success.join('\n')).toContain('Memory/auto-proj--topic.md');
  });

  it('says so when there is nothing to import', async () => {
    const { ingestAutoMemoryCmd } = await import('./ingest.js');
    await ingestAutoMemoryCmd({ projectsDir: projects });

    expect(logs.info.join('\n')).toContain('no auto-memory files found');
  });

  it('names both paths on a conflict', async () => {
    const mem = join(projects, '-proj', 'memory');
    await mkdir(mem, { recursive: true });
    await writeFile(join(mem, 'topic.md'), 'v1\n');

    const { ingestAutoMemoryCmd, ingestAutoMemory } = await import('./ingest.js');
    await ingestAutoMemory({ projectsDir: projects, vaultRoot: vault });
    const note = join(vault, 'Memory', 'auto-proj--topic.md');
    const { readFile } = await import('node:fs/promises');
    await writeFile(note, (await readFile(note, 'utf8')).replace('v1', 'my edit'), 'utf8');
    await writeFile(join(mem, 'topic.md'), 'v2\n');

    await ingestAutoMemoryCmd({ projectsDir: projects });

    const warned = logs.warn.join('\n');
    expect(warned).toContain('Memory/auto-proj--topic.md');
    expect(warned).toContain(join(mem, 'topic.md'));
  });

  it('exits non-zero when there is no config', async () => {
    readConfig.mockResolvedValue(null);
    const { ingestAutoMemoryCmd } = await import('./ingest.js');
    await ingestAutoMemoryCmd({});

    expect(logs.error.join('\n')).toContain('metalmind init');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
