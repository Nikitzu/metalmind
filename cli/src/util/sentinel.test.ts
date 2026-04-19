import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_METALMIND_MARKERS,
  extractSentinelBlock,
  upsertSentinelBlock,
} from './sentinel.js';

describe('upsertSentinelBlock', () => {
  let tmp: string;
  let target: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'sentinel-'));
    target = join(tmp, 'FILE.md');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('creates the file when missing', async () => {
    const res = await upsertSentinelBlock({ path: target, content: 'hello\nworld' });
    expect(res.action).toBe('created');
    const contents = await readFile(target, 'utf8');
    expect(contents).toBe(
      `${DEFAULT_METALMIND_MARKERS.begin}\nhello\nworld\n${DEFAULT_METALMIND_MARKERS.end}\n`,
    );
  });

  it('inserts the block above existing content when no markers present', async () => {
    await writeFile(target, '# user notes\nfoo\n', 'utf8');
    const res = await upsertSentinelBlock({ path: target, content: 'managed body' });
    expect(res.action).toBe('inserted');
    const contents = await readFile(target, 'utf8');
    expect(contents.startsWith(DEFAULT_METALMIND_MARKERS.begin)).toBe(true);
    expect(contents).toContain('managed body');
    expect(contents).toContain('# user notes');
    expect(contents.endsWith('foo\n')).toBe(true);
  });

  it('updates existing block in place, preserving surrounding user content', async () => {
    const initial = [
      '# above',
      '',
      `${DEFAULT_METALMIND_MARKERS.begin}`,
      'old body',
      `${DEFAULT_METALMIND_MARKERS.end}`,
      '',
      '# below',
      '',
    ].join('\n');
    await writeFile(target, initial, 'utf8');
    const res = await upsertSentinelBlock({ path: target, content: 'new body' });
    expect(res.action).toBe('updated');
    const contents = await readFile(target, 'utf8');
    expect(contents).toContain('new body');
    expect(contents).not.toContain('old body');
    expect(contents.startsWith('# above\n\n')).toBe(true);
    expect(contents).toContain('# below');
  });

  it('is idempotent: second run with same content returns unchanged', async () => {
    await upsertSentinelBlock({ path: target, content: 'same' });
    const res = await upsertSentinelBlock({ path: target, content: 'same' });
    expect(res.action).toBe('unchanged');
  });

  it('extractSentinelBlock returns managed content or null', async () => {
    await upsertSentinelBlock({ path: target, content: 'payload' });
    const source = await readFile(target, 'utf8');
    expect(extractSentinelBlock(source)).toBe('payload');
    expect(extractSentinelBlock('no markers here')).toBeNull();
  });
});
