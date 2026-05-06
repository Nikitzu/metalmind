import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyClaudeTemplates } from './templates.js';

// Snapshot truth: the rendered CC commands/save.md as it shipped in v0.7.x,
// captured BEFORE the .shared/save-body.md partial extraction. After the
// extraction this test MUST still match — proves CC behavior is byte-identical.
//
// Snapshot lives at __snapshots__/save-snapshot.test.ts.snap and is committed.

const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

describe('CC save.md byte-identical snapshot', () => {
  let claudeDir: string;

  beforeEach(async () => {
    claudeDir = await mkdtemp(join(tmpdir(), 'mm-save-snap-'));
  });

  afterEach(async () => {
    await rm(claudeDir, { recursive: true, force: true });
  });

  it('classic flavor, eodHook=true, notifications=true matches v0.7.x output', async () => {
    await copyClaudeTemplates({
      templatesDir: TEMPLATES_DIR,
      claudeDir,
      flavor: 'classic',
      eodHook: true,
      notifications: true,
    });
    const rendered = await readFile(join(claudeDir, 'commands', 'save.md'), 'utf8');
    expect(rendered).toMatchSnapshot();
  });

  it('scadrial flavor, eodHook=true, notifications=true matches v0.7.x output', async () => {
    await copyClaudeTemplates({
      templatesDir: TEMPLATES_DIR,
      claudeDir,
      flavor: 'scadrial',
      eodHook: true,
      notifications: true,
    });
    const rendered = await readFile(join(claudeDir, 'commands', 'save.md'), 'utf8');
    expect(rendered).toMatchSnapshot();
  });

  it('classic flavor, eodHook=false, notifications=false matches v0.7.x output', async () => {
    await copyClaudeTemplates({
      templatesDir: TEMPLATES_DIR,
      claudeDir,
      flavor: 'classic',
      eodHook: false,
      notifications: false,
    });
    const rendered = await readFile(join(claudeDir, 'commands', 'save.md'), 'utf8');
    expect(rendered).toMatchSnapshot();
  });

  it('classic flavor, eodHook=true, notifications=false matches v0.7.x output', async () => {
    await copyClaudeTemplates({
      templatesDir: TEMPLATES_DIR,
      claudeDir,
      flavor: 'classic',
      eodHook: true,
      notifications: false,
    });
    const rendered = await readFile(join(claudeDir, 'commands', 'save.md'), 'utf8');
    expect(rendered).toMatchSnapshot();
  });
});
