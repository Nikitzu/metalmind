#!/usr/bin/env node
// Copy ../packages/vault-rag → cli/templates/vault-rag-pkg so the bundled
// npm tarball carries the Python package next to dist/cli.js. Source of
// truth is packages/vault-rag/. The mirrored copy is gitignored.
//
// Runs at `pnpm build` and `pnpm prepack`. Idempotent: removes the target
// subtree first, then walks the source skipping dev artefacts.

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(__dirname, '..');
const MONOREPO_ROOT = resolve(CLI_ROOT, '..');
const SRC = join(MONOREPO_ROOT, 'packages', 'vault-rag');
const DEST = join(CLI_ROOT, 'templates', 'vault-rag-pkg');

const SKIP_DIRS = new Set([
  '.venv',
  '__pycache__',
  '.pytest_cache',
  '.ruff_cache',
  'dist',
  'build',
  'node_modules',
]);
const SKIP_FILE_SUFFIXES = ['.pyc', '.egg-info'];

function shouldSkip(name) {
  if (SKIP_DIRS.has(name)) return true;
  if (name.startsWith('.') && !['.gitignore', '.python-version'].includes(name)) return true;
  return SKIP_FILE_SUFFIXES.some((suf) => name.endsWith(suf));
}

async function ensureSrc() {
  try {
    await stat(SRC);
  } catch {
    console.error(`sync-vault-rag-pkg: source missing at ${SRC}`);
    process.exit(1);
  }
}

await ensureSrc();
await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });
await cp(SRC, DEST, {
  recursive: true,
  filter: (src) => {
    const name = src.split('/').pop() ?? '';
    return !shouldSkip(name);
  },
});

console.log(`sync-vault-rag-pkg: copied packages/vault-rag/ → cli/templates/vault-rag-pkg/`);
