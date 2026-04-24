import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shelfDir } from '../forge/openapi.js';
import { forgeCaptureSpec } from './forge.js';

describe('forge capture-spec', () => {
  let home: string;
  let repo: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'mm-home-'));
    repo = await mkdtemp(join(tmpdir(), 'coreapi-bookings-'));
    prevHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    await rm(home, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it('copies a local spec file onto the shelf keyed on repo basename', async () => {
    const src = join(repo, 'captured.yaml');
    await writeFile(src, 'openapi: 3.0.1\npaths: {}\n', 'utf8');
    await forgeCaptureSpec(repo, src);
    const base = repo.split('/').pop() as string;
    const dest = join(shelfDir(), `${base}.yaml`);
    const body = await readFile(dest, 'utf8');
    expect(body).toContain('openapi: 3.0.1');
  });

  it('picks .json extension when source is json', async () => {
    const src = join(repo, 'spec.json');
    await writeFile(src, '{"paths":{}}', 'utf8');
    await forgeCaptureSpec(repo, src);
    const base = repo.split('/').pop() as string;
    await expect(stat(join(shelfDir(), `${base}.json`))).resolves.toBeTruthy();
  });

  it('honors --as to override slug', async () => {
    const src = join(repo, 'spec.yaml');
    await writeFile(src, 'paths: {}\n', 'utf8');
    await forgeCaptureSpec(repo, src, { as: 'custom-slug' });
    await expect(stat(join(shelfDir(), 'custom-slug.yaml'))).resolves.toBeTruthy();
  });

  it('removes stale variants of same slug when extension changes', async () => {
    const base = repo.split('/').pop() as string;
    const yamlSrc = join(repo, 'a.yaml');
    const jsonSrc = join(repo, 'a.json');
    await writeFile(yamlSrc, 'paths: {}\n', 'utf8');
    await writeFile(jsonSrc, '{"paths":{}}', 'utf8');

    await forgeCaptureSpec(repo, yamlSrc);
    await expect(stat(join(shelfDir(), `${base}.yaml`))).resolves.toBeTruthy();

    await forgeCaptureSpec(repo, jsonSrc);
    await expect(stat(join(shelfDir(), `${base}.json`))).resolves.toBeTruthy();
    const files = await readdir(shelfDir());
    expect(files.filter((f) => f.startsWith(base))).toEqual([`${base}.json`]);
  });
});
