import { describe, expect, it, vi } from 'vitest';

const multiselect = vi.hoisted(() =>
  vi.fn<(args: { initialValues?: unknown }) => Promise<unknown>>(),
);
const isCancel = vi.hoisted(() => vi.fn<(v: unknown) => boolean>(() => false));

vi.mock('@clack/prompts', () => ({ multiselect, isCancel }));

import { promptHosts } from './host-prompt.js';

describe('promptHosts', () => {
  it('returns [] when no hosts detected (no prompt fires)', async () => {
    multiselect.mockReset();
    const result = await promptHosts({ detection: { claude: false, codex: false, cursor: false } });
    expect(result).toEqual({ hosts: [], cancelled: false });
    expect(multiselect).not.toHaveBeenCalled();
  });

  it('forced overrides everything; intersected with detection', async () => {
    multiselect.mockReset();
    const result = await promptHosts({
      detection: { claude: true, codex: true, cursor: false },
      forced: ['codex'],
    });
    expect(result.hosts).toEqual(['codex']);
    expect(multiselect).not.toHaveBeenCalled();
  });

  it('forced silently drops undetected hosts', async () => {
    const result = await promptHosts({
      detection: { claude: true, codex: false, cursor: false },
      forced: ['codex'],
    });
    expect(result.hosts).toEqual([]);
  });

  it('noPrompt returns preChecked verbatim (intersected with detection)', async () => {
    multiselect.mockReset();
    const result = await promptHosts({
      detection: { claude: true, codex: true, cursor: false },
      preChecked: ['codex'],
      noPrompt: true,
    });
    expect(result.hosts).toEqual(['codex']);
    expect(multiselect).not.toHaveBeenCalled();
  });

  it('noPrompt with preChecked dropping undetected', async () => {
    const result = await promptHosts({
      detection: { claude: true, codex: false, cursor: false },
      preChecked: ['codex'],
      noPrompt: true,
    });
    expect(result.hosts).toEqual([]);
  });

  it('interactive: pre-checks previously chosen hosts via initialValues', async () => {
    multiselect.mockReset();
    multiselect.mockImplementation(async ({ initialValues }) => initialValues as unknown);
    const result = await promptHosts({
      detection: { claude: true, codex: true, cursor: false },
      preChecked: ['claude'],
      isTTY: true,
    });
    expect(multiselect).toHaveBeenCalledTimes(1);
    expect(result.hosts).toEqual(['claude']);
  });

  it('interactive: pre-checks all detected when no preChecked given', async () => {
    multiselect.mockReset();
    multiselect.mockImplementation(async ({ initialValues }) => initialValues as unknown);
    const result = await promptHosts({
      detection: { claude: true, codex: true, cursor: false },
      isTTY: true,
    });
    expect(result.hosts).toEqual(['claude', 'codex']);
  });

  it('headless (no TTY): falls back to preChecked without prompting', async () => {
    multiselect.mockReset();
    const result = await promptHosts({
      detection: { claude: true, codex: true, cursor: false },
      preChecked: ['claude'],
      isTTY: false,
    });
    expect(multiselect).not.toHaveBeenCalled();
    expect(result).toEqual({ hosts: ['claude'], cancelled: false });
  });

  it('cancellation returns { hosts: [], cancelled: true }', async () => {
    const cancelSym = Symbol('clack:cancel');
    multiselect.mockReset();
    isCancel.mockReset();
    multiselect.mockResolvedValue(cancelSym);
    isCancel.mockImplementation((v) => v === cancelSym);
    const result = await promptHosts({
      detection: { claude: true, codex: true, cursor: false },
      isTTY: true,
    });
    expect(result).toEqual({ hosts: [], cancelled: true });
  });
});
