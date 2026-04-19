import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTemplatesDir } from '../util/paths.js';

// Placeholders we know about — rendered at install time by the relevant
// installer. Anything else in a template is a bug: Claude would see the
// literal {{WHATEVER}} string at runtime.
const KNOWN_PLACEHOLDERS = new Set([
  'VAULT_PATH', // rendered by launchd.ts, systemd.ts, stampClaudeMd
  'WATCHER_BIN', // rendered by launchd.ts, systemd.ts
  'UV_BIN', // rendered by launchd.ts, systemd.ts (watcher invoked as `uv tool run`)
  'PATH_VALUE', // rendered by launchd.ts, systemd.ts
  'RECALL_CMD', // rendered by vault.ts, templates.ts (save.md + agents + rules)
  'HOME', // rendered by serena.ts into serena_config.yml
]);

// Templates that must be rendered before they land on disk. Any {{PLACEHOLDER}}
// token inside them MUST be in KNOWN_PLACEHOLDERS. Files outside this allowlist
// are free-form content (e.g. agent markdown bodies) and can contain literal
// braces without issue.
const RENDERABLE_SUFFIXES = ['.template', 'CLAUDE.md.template', 'CLAUDE.md.block.template'];

const SKIP_DIRS = new Set([
  '__pycache__',
  'node_modules',
  '.venv',
  '.pytest_cache',
  '.ruff_cache',
  'dist',
  'site-packages',
]);

async function* walk(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue; // .venv, .git, etc
      yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function extractPlaceholders(content: string): Set<string> {
  const out = new Set<string>();
  for (const match of content.matchAll(/\{\{(\w+)\}\}/g)) {
    if (match[1]) out.add(match[1]);
  }
  return out;
}

describe('template placeholders', () => {
  it('every template placeholder is in the known set (no drift)', async () => {
    const templatesDir = getTemplatesDir();
    const violations: Array<{ file: string; placeholder: string }> = [];

    for await (const path of walk(templatesDir)) {
      const st = await stat(path);
      if (st.isDirectory()) continue;
      // Only check text files — .template, .md, .sh, .yml.
      if (!/\.(template|md|sh|ya?ml|toml|py)$/i.test(path)) continue;

      const content = await readFile(path, 'utf8');
      const phs = extractPlaceholders(content);
      for (const ph of phs) {
        if (!KNOWN_PLACEHOLDERS.has(ph)) {
          violations.push({ file: path, placeholder: ph });
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file} uses {{${v.placeholder}}}`)
        .join('\n');
      throw new Error(
        `Unknown template placeholders. Add them to KNOWN_PLACEHOLDERS (and the renderer) or rewrite the template:\n${msg}`,
      );
    }
  });

  it('renderable template files exist for every site the installer expects', async () => {
    const templatesDir = getTemplatesDir();
    const required = [
      'claude/CLAUDE.md.block.template',
      'claude/CLAUDE.md.starter.template',
      'vault/CLAUDE.md.block.template',
      'launchd/com.metalmind.vault-indexer.plist.template',
      'systemd/metalmind-vault-indexer.service.template',
    ];
    for (const rel of required) {
      const path = join(templatesDir, rel);
      const content = await readFile(path, 'utf8');
      expect(content.length, `${rel} is empty`).toBeGreaterThan(0);
    }
    // Keep the list aligned with installer expectations. Silence unused var lint.
    expect(RENDERABLE_SUFFIXES.length).toBeGreaterThan(0);
  });
});
