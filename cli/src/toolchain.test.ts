import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('toolchain pin', () => {
  it('pins pnpm 12 or later, since pnpm 9 expanded backticks and $ in `pnpm dev` arguments', async () => {
    const root = JSON.parse(await readFile(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const match = /^pnpm@(\d+)\./.exec(root.packageManager ?? '');
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(12);
  });
});
