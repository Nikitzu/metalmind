import { afterEach, describe, expect, it, vi } from 'vitest';
import { RETIRED_COMMANDS, retired } from './retired.js';

describe('retired commands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('names a codegraph replacement for every retired command', () => {
    for (const [name, entry] of Object.entries(RETIRED_COMMANDS)) {
      expect(entry.replacement, name).toContain('codegraph');
      expect(entry.reason, name).toBeTruthy();
    }
  });

  it('does not tombstone burn iron or symbol - those run natively again', () => {
    expect(RETIRED_COMMANDS['burn iron']).toBeUndefined();
    expect(RETIRED_COMMANDS.symbol).toBeUndefined();
  });

  it('covers both the scadrial and classic spellings', () => {
    for (const name of ['burn bronze', 'burn pewter', 'graph', 'reindex']) {
      expect(RETIRED_COMMANDS[name], name).toBeDefined();
    }
  });

  it('exits non-zero and prints the replacement command', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    retired('burn bronze');
    expect(process.exitCode).toBe(1);
    const printed = write.mock.calls.map((c) => String(c[0])).join('');
    expect(printed).toContain('codegraph explore');
    expect(printed).toContain('metalmind forge');
  });

  it('still fails loudly for an unknown command name', () => {
    retired('burn nicrosil');
    expect(process.exitCode).toBe(1);
  });
});
