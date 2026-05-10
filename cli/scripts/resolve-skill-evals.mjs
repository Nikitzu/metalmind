#!/usr/bin/env node
/**
 * Resolve skill eval SKILL.md files: expand {{> .shared/...}} partials and
 * substitute {{RECALL_CMD}} per flavor. Writes resolved copies to a temp dir
 * that agent-skills-eval can consume directly.
 *
 * Usage: node resolve-skill-evals.mjs [--flavor scadrial|classic]
 * Prints the resolved output directory path to stdout.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const TEMPLATES_DIR = resolve(import.meta.dirname, '..', 'templates');
const EVALS_DIR = resolve(import.meta.dirname, '..', 'skills-evals');

const flavorIdx = process.argv.indexOf('--flavor');
const flavorArg = flavorIdx !== -1 ? process.argv[flavorIdx + 1] : 'scadrial';
const recallCmd = flavorArg === 'classic' ? 'metalmind recall' : 'metalmind tap copper';

const PARTIAL_RE = /\{\{>\s*([^\s}]+)\s*\}\}/g;

function resolvePartials(source) {
  return source.replace(PARTIAL_RE, (_match, partialPath) => {
    const fullPath = join(TEMPLATES_DIR, partialPath);
    if (!existsSync(fullPath)) {
      throw new Error(`Partial not found: ${fullPath}`);
    }
    const partial = readFileSync(fullPath, 'utf8');
    return resolvePartials(partial);
  });
}

function resolveRecallCmd(source) {
  return source.replace(/\{\{RECALL_CMD\}\}/g, recallCmd);
}

const outDir = mkdtempSync(join(tmpdir(), 'metalmind-skill-evals-'));

for (const skill of readdirSync(EVALS_DIR, { withFileTypes: true })) {
  if (!skill.isDirectory()) continue;
  const skillDir = join(EVALS_DIR, skill.name);
  const skillMd = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMd)) continue;

  const destDir = join(outDir, skill.name);
  cpSync(skillDir, destDir, { recursive: true, dereference: true });

  const raw = readFileSync(join(destDir, 'SKILL.md'), 'utf8');
  const resolved = resolveRecallCmd(resolvePartials(raw));
  writeFileSync(join(destDir, 'SKILL.md'), resolved, 'utf8');
}

process.stdout.write(outDir);
