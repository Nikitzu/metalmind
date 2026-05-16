# Cursor Host Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use mzyx-skills:subagent-driven-development (recommended) or mzyx-skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cursor as a third metalmind install host so `metalmind stamp --host cursor` wires the Cursor agent for vault recall + scribe writes.

**Architecture:** Mirror the existing `cli/src/install/codex/` module set with a new `cli/src/install/cursor/` directory (per-section primitives + orchestrator). Recall is delivered by a new `metalmind-recall` skill (Cursor's `sessionStart` hook `additional_context` is a staff-confirmed broken path in Cursor 3.1.15); the `sessionStart` hook is still installed but latent. Prose bodies are single-sourced from `cli/templates/.shared/`; Cursor-specific frontmatter shells live in a new `cli/templates/cursor/` tree.

**Tech Stack:** TypeScript (ESM), Node ≥ 20, pnpm workspaces, commander, vitest, tsup, Biome.

**Spec:** `docs/specs/2026-05-16-cursor-host-port-spec.md`

---

## Progress

Branch: `cursor-host-port`. Execution: inline, paused after Task 5.

- [x] **Task 1** — Widen host type to cursor — `246869e` — CHECKPOINT 1 passed
- [x] **Task 2** — Shared module + recall-skill/hook templates — `f7e17df`
- [x] **Task 3** — Cursor skills install (incl. metalmind-recall) — `41c25ad`
- [x] **Task 4** — Cursor subagents install (15 agents) — `47b4d01`
- [x] **Task 5** — Latent sessionStart hook — `669a84c` — CHECKPOINT 2 passed
- [ ] **Task 6** — Opt-in MCP registration ← resume here
- [ ] **Task 7** — Orchestrator + barrel — CHECKPOINT 3
- [ ] **Task 8** — Wire stamp + init
- [ ] **Task 9** — Wire uninstall + doctor
- [ ] **Task 10** — Full verification + smoke test — CHECKPOINT 4

Deviation log:
- Task 5: plan's hook test used `'bash mm.sh'` as the fake `hookCommand` — lacks
  the `metalmind-cursor-session-start.sh` marker, so idempotency/clear could not
  identify the entry. Test fixture changed to a marker-containing command; impl
  unchanged.

---

## Reference files (read before starting)

The Codex host is the structural template. Each Cursor file mirrors a Codex
counterpart with the differences called out per task:

| New Cursor file | Mirrors | Key differences |
|---|---|---|
| `cli/src/install/cursor/shared.ts` | `codex/shared.ts` | `~/.cursor` dir |
| `cli/src/install/cursor/skills.ts` | `codex/skills.ts` | adds `metalmind-recall`; Cursor `SKILL.md` frontmatter has no `model` field |
| `cli/src/install/cursor/agents.ts` | `codex/agents.ts` (structure only) | copies 15 agent files into `~/.cursor/agents/`, not an AGENTS.md block |
| `cli/src/install/cursor/hooks.ts` | `codex/hooks.ts` | Cursor `hooks.json` uses `{version,hooks:{sessionStart:[{command}]}}` — lowercase event, flat `{command}` entries, top-level `version: 1` |
| `cli/src/install/cursor/mcp.ts` | `codex/mcp.ts` | writes `~/.cursor/mcp.json` directly (no `cursor mcp add` CLI dependency) |
| `cli/src/install/cursor/orchestrator.ts` | `codex/orchestrator.ts` | composes the above |

## File structure

```
cli/src/config.ts                       MODIFY  — add 'cursor' to HostSchema
cli/src/install/hosts.ts                 MODIFY  — add cursor detection
cli/src/install/host-prompt.ts           MODIFY  — add cursor label/order
cli/src/install/cursor/shared.ts         CREATE
cli/src/install/cursor/skills.ts         CREATE
cli/src/install/cursor/skills.test.ts    CREATE
cli/src/install/cursor/agents.ts         CREATE
cli/src/install/cursor/agents.test.ts    CREATE
cli/src/install/cursor/hooks.ts          CREATE
cli/src/install/cursor/hooks.test.ts     CREATE
cli/src/install/cursor/mcp.ts            CREATE
cli/src/install/cursor/mcp.test.ts       CREATE
cli/src/install/cursor/orchestrator.ts   CREATE
cli/src/install/cursor/orchestrator.test.ts CREATE
cli/src/install/cursor.ts                CREATE  — barrel re-export (matches install/codex.ts)
cli/src/commands/stamp.ts                MODIFY  — dispatch cursor
cli/src/commands/init.ts                 MODIFY  — dispatch cursor
cli/src/commands/uninstall.ts            MODIFY  — uninstall cursor
cli/src/commands/doctor.ts               MODIFY  — cursor health branch
cli/src/install/hosts.test.ts            MODIFY  — cursor detection cases
cli/src/install/host-prompt.test.ts      MODIFY  — cursor prompt cases

cli/templates/cursor/                    CREATE
  hooks/session-start.sh.template
  skills/metalmind-recall/SKILL.md
```

Skill bodies for `writing-vault-notes`, `synod`, `save` are reused from
`cli/templates/.shared/skills/` and `cli/templates/codex/skills/` — no new copies.
Agent bodies are reused from `cli/templates/claude/agents/*.md`.

---

## Task 1: Widen the host type to include `cursor`

**Files:**
- Modify: `cli/src/config.ts:13`
- Modify: `cli/src/install/hosts.ts:8-37`
- Modify: `cli/src/install/host-prompt.ts:28-33`
- Test: `cli/src/install/hosts.test.ts`

- [ ] **Step 1: Write the failing test** in `cli/src/install/hosts.test.ts` (add to the existing `describe`):

```ts
it('detects cursor when ~/.cursor exists', () => {
  const home = mkdtempSync(join(tmpdir(), 'mm-hosts-'));
  mkdirSync(join(home, '.cursor'));
  const result = detectHosts({ home });
  expect(result.cursor).toBe(true);
  expect(detectedAsList(result)).toContain('cursor');
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter metalmind test -- hosts.test.ts`
Expected: FAIL — `result.cursor` is `undefined`, type error on `cursor`.

- [ ] **Step 3: Add `cursor` to the host enum** — `cli/src/config.ts:13`:

```ts
const HostSchema = z.enum(['claude', 'codex', 'cursor']);
```

- [ ] **Step 4: Extend `hosts.ts`** — replace lines 8-37:

```ts
export interface HostsDetectionResult {
  claude: boolean;
  codex: boolean;
  cursor: boolean;
}

export interface DetectHostsOptions {
  /** Override $HOME for testing. Defaults to os.homedir(). */
  home?: string;
}

export const HOST_DIRS: Record<MetalmindHost, string> = {
  claude: '.claude',
  codex: '.codex',
  cursor: '.cursor',
};

export function detectHosts(opts: DetectHostsOptions = {}): HostsDetectionResult {
  const home = opts.home ?? homedir();
  return {
    claude: existsSync(join(home, HOST_DIRS.claude)),
    codex: existsSync(join(home, HOST_DIRS.codex)),
    cursor: existsSync(join(home, HOST_DIRS.cursor)),
  };
}

/** Convert detection result to an ordered list of detected hosts. */
export function detectedAsList(detection: HostsDetectionResult): MetalmindHost[] {
  const out: MetalmindHost[] = [];
  if (detection.claude) out.push('claude');
  if (detection.codex) out.push('codex');
  if (detection.cursor) out.push('cursor');
  return out;
}
```

- [ ] **Step 5: Extend `host-prompt.ts`** — replace lines 28-33:

```ts
const HOST_LABELS: Record<MetalmindHost, string> = {
  claude: 'Claude Code (~/.claude)',
  codex: 'Codex CLI (~/.codex)',
  cursor: 'Cursor (~/.cursor)',
};

const HOST_ORDER: readonly MetalmindHost[] = ['claude', 'codex', 'cursor'];
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter metalmind test -- hosts.test.ts host-prompt.test.ts && pnpm typecheck`
Expected: PASS. Typecheck surfaces every unhandled `cursor` switch case — note them for later tasks; they are expected at this stage.

- [ ] **Step 7: Commit**

```bash
git add cli/src/config.ts cli/src/install/hosts.ts cli/src/install/host-prompt.ts cli/src/install/hosts.test.ts
git commit -m "feat(cursor): widen host type to include cursor"
```

### CHECKPOINT 1 — review the type widening before building install primitives.

---

## Task 2: Cursor shared module + recall-skill template

**Files:**
- Create: `cli/src/install/cursor/shared.ts`
- Create: `cli/templates/cursor/skills/metalmind-recall/SKILL.md`
- Create: `cli/templates/cursor/hooks/session-start.sh.template`

- [ ] **Step 1: Create `cli/src/install/cursor/shared.ts`**

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_CURSOR_DIR = join(homedir(), '.cursor');

export function recallCommand(flavor: 'scadrial' | 'classic'): string {
  return flavor === 'scadrial' ? 'metalmind tap copper' : 'metalmind recall';
}
```

(Identical body to `codex/shared.ts` except the dir constant — kept separate so
the two hosts can diverge without coupling.)

- [ ] **Step 2: Create `cli/templates/cursor/skills/metalmind-recall/SKILL.md`**

```markdown
---
name: metalmind-recall
description: Recall prior decisions, architecture notes, and context from the metalmind knowledge vault. Use before any non-trivial task — architecture, design, debugging, planning — to check what was already decided. Do not use for trivial one-line edits or pure syntax lookups.
---

# metalmind recall

Before starting a non-trivial task, recall relevant prior context from the vault:

```bash
{{RECALL_CMD}} "<query>"
```

- Add `--deep` for related notes, `--expand` for linked context.
- Rephrase the query 2-3× if the first attempt misses — the vault may use
  different wording.
- Skip recall for trivial one-off edits and pure syntax lookups.

To write to the vault, use `metalmind scribe <create|update|patch>` — never raw
file writes.
```

- [ ] **Step 3: Create `cli/templates/cursor/hooks/session-start.sh.template`**

This is the latent hook. It emits Cursor's snake_case `additional_context` schema
(distinct from Claude Code's `hookSpecificOutput.additionalContext`):

```bash
#!/usr/bin/env bash
# metalmind-cursor-session-start — Cursor sessionStart hook.
#
# LATENT: Cursor 3.1.15 has a staff-confirmed bug where additional_context
# from sessionStart is dropped before reaching the agent. This script is
# correct per the documented schema and starts working when Cursor ships the
# fix. Until then, recall is delivered by the metalmind-recall skill.
set -euo pipefail
cat <<'JSON'
{
  "additional_context": "metalmind memory is available. Before any non-trivial task, run `{{RECALL_CMD}} \"<query>\"` to recall prior decisions from the vault. Use `metalmind scribe` to write notes — never raw file writes."
}
JSON
```

- [ ] **Step 4: Verify the template renders** — manual check, no test yet:

Run: `node -e "console.log(require('fs').readFileSync('cli/templates/cursor/hooks/session-start.sh.template','utf8'))"`
Expected: prints the script with the literal `{{RECALL_CMD}}` placeholder intact.

- [ ] **Step 5: Commit**

```bash
git add cli/src/install/cursor/shared.ts cli/templates/cursor/
git commit -m "feat(cursor): add shared module + recall-skill and hook templates"
```

---

## Task 3: Cursor skills install (`cursor/skills.ts`)

**Files:**
- Create: `cli/src/install/cursor/skills.ts`
- Test: `cli/src/install/cursor/skills.test.ts`

Structurally mirror `cli/src/install/codex/skills.ts`. Differences:
- Skill set is `['metalmind-recall', 'writing-vault-notes', 'synod', 'save']`.
- `metalmind-recall` sources from `cli/templates/cursor/skills/`; the other three
  reuse the same sources `codex/skills.ts` uses (`.shared` / `codex`).
- Target root is `join(cursorDir, 'skills')`.

- [ ] **Step 1: Write the failing test** — `cli/src/install/cursor/skills.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyCursorSkills, removeCursorSkills } from './skills.js';

describe('copyCursorSkills', () => {
  it('copies metalmind-recall with RECALL_CMD substituted', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const result = await copyCursorSkills({ cursorDir, flavor: 'scadrial' });
    expect(result.copied).toContain('metalmind-recall');
    const skill = readFileSync(
      join(cursorDir, 'skills', 'metalmind-recall', 'SKILL.md'),
      'utf8',
    );
    expect(skill).toContain('metalmind tap copper');
    expect(skill).not.toContain('{{RECALL_CMD}}');
  });

  it('removeCursorSkills deletes only metalmind skills', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    await copyCursorSkills({ cursorDir, flavor: 'scadrial' });
    const removed = await removeCursorSkills({ cursorDir });
    expect(removed).toContain('metalmind-recall');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter metalmind test -- cursor/skills.test.ts`
Expected: FAIL — module `./skills.js` not found.

- [ ] **Step 3: Implement `cli/src/install/cursor/skills.ts`**

Copy `codex/skills.ts` verbatim, then apply these edits:
- Rename every `Codex`/`codex` identifier to `Cursor`/`cursor`; import
  `DEFAULT_CURSOR_DIR` from `./shared.js`.
- `METALMIND_CURSOR_SKILLS = ['metalmind-recall', 'writing-vault-notes', 'synod', 'save'] as const;`
- Extend the source map:

```ts
const CURSOR_SKILL_SOURCE: Record<MetalmindCursorSkill, '.shared' | 'codex' | 'cursor'> = {
  'metalmind-recall': 'cursor',
  'writing-vault-notes': '.shared',
  synod: '.shared',
  save: 'codex',
};
```
- In the copy loop, resolve the `'cursor'` source tree to
  `join(templatesDir, 'cursor', 'skills', skill)`.

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter metalmind test -- cursor/skills.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add cli/src/install/cursor/skills.ts cli/src/install/cursor/skills.test.ts
git commit -m "feat(cursor): install skills incl. metalmind-recall"
```

---

## Task 4: Cursor subagents install (`cursor/agents.ts`)

**Files:**
- Create: `cli/src/install/cursor/agents.ts`
- Test: `cli/src/install/cursor/agents.test.ts`

Copies the 15 agent markdown files from `cli/templates/claude/agents/` into
`~/.cursor/agents/`. Cursor reads the Claude Code agent frontmatter
(`name`, `description`, `model`) directly; the Cursor-only fields `readonly` /
`is_background` are optional and omitted (defaults are correct). No frontmatter
rewrite is needed for v1 — the files copy as-is.

- [ ] **Step 1: Write the failing test** — `cli/src/install/cursor/agents.test.ts`:

```ts
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyCursorAgents, removeCursorAgents } from './agents.js';

describe('copyCursorAgents', () => {
  it('copies all claude agent files into ~/.cursor/agents/', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const result = await copyCursorAgents({ cursorDir });
    expect(result.copied.length).toBeGreaterThanOrEqual(15);
    const files = readdirSync(join(cursorDir, 'agents'));
    expect(files).toContain('architect.md');
  });

  it('removeCursorAgents deletes the copied files', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    await copyCursorAgents({ cursorDir });
    const removed = await removeCursorAgents({ cursorDir });
    expect(removed.length).toBeGreaterThanOrEqual(15);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter metalmind test -- cursor/agents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cli/src/install/cursor/agents.ts`**

```ts
// Cursor subagents (~/.cursor/agents/*.md).
//
// Cursor reads Claude Code agent frontmatter (name/description/model) directly.
// We copy the 15 metalmind specialist agents from cli/templates/claude/agents/
// as-is — the Cursor-only fields (readonly, is_background) default correctly.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getTemplatesDir } from '../../util/paths.js';
import { DEFAULT_CURSOR_DIR } from './shared.js';

export interface CopyCursorAgentsOptions {
  templatesDir?: string;
  cursorDir?: string;
}

export interface CopyCursorAgentsResult {
  copied: string[];
}

export async function copyCursorAgents(
  opts: CopyCursorAgentsOptions = {},
): Promise<CopyCursorAgentsResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const srcDir = join(templatesDir, 'claude', 'agents');
  const destDir = join(cursorDir, 'agents');
  await mkdir(destDir, { recursive: true });

  const copied: string[] = [];
  if (!existsSync(srcDir)) return { copied };
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      await copyFile(join(srcDir, entry.name), join(destDir, entry.name));
      copied.push(entry.name);
    }
  }
  return { copied };
}

/** Remove metalmind-shipped agents from ~/.cursor/agents/. Preserves user agents. */
export async function removeCursorAgents(
  opts: { templatesDir?: string; cursorDir?: string } = {},
): Promise<string[]> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const srcDir = join(templatesDir, 'claude', 'agents');
  const destDir = join(cursorDir, 'agents');
  if (!existsSync(srcDir) || !existsSync(destDir)) return [];

  const removed: string[] = [];
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const target = join(destDir, entry.name);
    if (existsSync(target)) {
      await rm(target, { force: true });
      removed.push(entry.name);
    }
  }
  return removed;
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter metalmind test -- cursor/agents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/install/cursor/agents.ts cli/src/install/cursor/agents.test.ts
git commit -m "feat(cursor): copy 15 specialist subagents into ~/.cursor/agents/"
```

---

## Task 5: Cursor sessionStart hook (`cursor/hooks.ts`)

**Files:**
- Create: `cli/src/install/cursor/hooks.ts`
- Test: `cli/src/install/cursor/hooks.test.ts`

Mirrors `codex/hooks.ts` structurally but the Cursor `hooks.json` shape differs:
- Top-level `version: 1`.
- Event key is lowercase `sessionStart` (Codex uses `SessionStart`).
- Entries are flat `{ command }` objects — no `{ matcher, hooks: [...] }` group
  nesting.

- [ ] **Step 1: Write the failing test** — `cli/src/install/cursor/hooks.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCursorHooksJson, clearCursorHooksJson, copyCursorHook } from './hooks.js';

describe('cursor hooks', () => {
  it('copyCursorHook renders RECALL_CMD and emits snake_case additional_context', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const result = await copyCursorHook({ cursorDir, flavor: 'scadrial' });
    const script = readFileSync(result.hookScriptPath, 'utf8');
    expect(script).toContain('"additional_context"');
    expect(script).toContain('metalmind tap copper');
    expect(script).not.toContain('{{RECALL_CMD}}');
  });

  it('applyCursorHooksJson merges without clobbering existing hooks', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const hooksJsonPath = join(cursorDir, 'hooks.json');
    writeFileSync(
      hooksJsonPath,
      JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: 'user-hook.sh' }] } }),
    );
    await applyCursorHooksJson({ hooksJsonPath, hookCommand: 'bash mm.sh' });
    const data = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
    expect(data.version).toBe(1);
    expect(data.hooks.sessionStart).toHaveLength(2);
    expect(data.hooks.sessionStart.map((h: { command: string }) => h.command)).toContain(
      'user-hook.sh',
    );
  });

  it('applyCursorHooksJson is idempotent', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const hooksJsonPath = join(cursorDir, 'hooks.json');
    await applyCursorHooksJson({ hooksJsonPath, hookCommand: 'bash mm.sh' });
    const second = await applyCursorHooksJson({ hooksJsonPath, hookCommand: 'bash mm.sh' });
    expect(second.changed).toBe(false);
  });

  it('clearCursorHooksJson removes only the metalmind entry', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const hooksJsonPath = join(cursorDir, 'hooks.json');
    writeFileSync(
      hooksJsonPath,
      JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: 'user-hook.sh' }] } }),
    );
    await applyCursorHooksJson({ hooksJsonPath, hookCommand: 'bash mm.sh' });
    await clearCursorHooksJson({ hooksJsonPath });
    const data = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
    expect(data.hooks.sessionStart).toEqual([{ command: 'user-hook.sh' }]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter metalmind test -- cursor/hooks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cli/src/install/cursor/hooks.ts`**

```ts
// sessionStart hook for Cursor (~/.cursor/hooks.json).
//
// LATENT: Cursor 3.1.15 drops sessionStart additional_context before it reaches
// the agent (staff-confirmed bug, 2026-05-03). The hook is installed correct-
// per-schema and activates when Cursor ships the fix. Recall meanwhile is
// delivered by the metalmind-recall skill.
//
// Cursor hooks.json shape differs from Codex: top-level `version: 1`, lowercase
// `sessionStart` event, flat `{ command }` entries (no matcher/hooks nesting).

import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getTemplatesDir } from '../../util/paths.js';
import { DEFAULT_CURSOR_DIR, recallCommand } from './shared.js';

export const METALMIND_CURSOR_HOOK_FILENAME = 'metalmind-cursor-session-start.sh';
const METALMIND_HOOK_MARKER = METALMIND_CURSOR_HOOK_FILENAME;

export interface CopyCursorHookOptions {
  templatesDir?: string;
  cursorDir?: string;
  flavor: 'scadrial' | 'classic';
}

export interface CopyCursorHookResult {
  hookScriptPath: string;
  hookCommand: string;
  action: 'created' | 'updated' | 'unchanged';
}

export async function copyCursorHook(opts: CopyCursorHookOptions): Promise<CopyCursorHookResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const hooksDir = join(cursorDir, 'hooks');
  await mkdir(hooksDir, { recursive: true });

  const hookScriptPath = join(hooksDir, METALMIND_CURSOR_HOOK_FILENAME);
  const srcPath = join(templatesDir, 'cursor', 'hooks', 'session-start.sh.template');
  const raw = await readFile(srcPath, 'utf8');
  const rendered = raw.replace(/\{\{RECALL_CMD\}\}/g, recallCommand(opts.flavor));

  let action: CopyCursorHookResult['action'] = 'created';
  if (existsSync(hookScriptPath)) {
    const existing = await readFile(hookScriptPath, 'utf8');
    action = existing === rendered ? 'unchanged' : 'updated';
  }
  if (action !== 'unchanged') {
    await writeFile(hookScriptPath, rendered, 'utf8');
    await chmod(hookScriptPath, 0o755);
  }
  return { hookScriptPath, hookCommand: `bash ${hookScriptPath}`, action };
}

interface CursorHookEntry {
  command: string;
}

interface CursorHooksFile {
  version?: number;
  hooks?: Record<string, CursorHookEntry[]>;
  [key: string]: unknown;
}

async function readHooksJson(path: string): Promise<CursorHooksFile> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as CursorHooksFile;
}

async function writeHooksJson(path: string, data: CursorHooksFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function isMetalmindEntry(entry: CursorHookEntry): boolean {
  return typeof entry?.command === 'string' && entry.command.includes(METALMIND_HOOK_MARKER);
}

export interface ApplyCursorHooksJsonOptions {
  hooksJsonPath?: string;
  hookCommand: string;
}

export interface ApplyCursorHooksJsonResult {
  hooksJsonPath: string;
  changed: boolean;
}

export async function applyCursorHooksJson(
  opts: ApplyCursorHooksJsonOptions,
): Promise<ApplyCursorHooksJsonResult> {
  const hooksJsonPath = opts.hooksJsonPath ?? join(DEFAULT_CURSOR_DIR, 'hooks.json');
  const data = await readHooksJson(hooksJsonPath);
  const hooks = data.hooks ?? {};
  const sessionStart = hooks.sessionStart ?? [];

  const other = sessionStart.filter((e) => !isMetalmindEntry(e));
  const existing = sessionStart.find(isMetalmindEntry);
  const alreadyCorrect = existing?.command === opts.hookCommand;

  if (alreadyCorrect && other.length === sessionStart.length - 1 && data.version === 1) {
    return { hooksJsonPath, changed: false };
  }

  hooks.sessionStart = [...other, { command: opts.hookCommand }];
  data.version = 1;
  data.hooks = hooks;
  await writeHooksJson(hooksJsonPath, data);
  return { hooksJsonPath, changed: true };
}

export async function clearCursorHooksJson(
  opts: { hooksJsonPath?: string } = {},
): Promise<boolean> {
  const hooksJsonPath = opts.hooksJsonPath ?? join(DEFAULT_CURSOR_DIR, 'hooks.json');
  if (!existsSync(hooksJsonPath)) return false;
  const data = await readHooksJson(hooksJsonPath);
  const hooks = data.hooks;
  if (!hooks || !Array.isArray(hooks.sessionStart)) return false;

  const filtered = hooks.sessionStart.filter((e) => !isMetalmindEntry(e));
  if (filtered.length === hooks.sessionStart.length) return false;

  if (filtered.length === 0) delete hooks.sessionStart;
  else hooks.sessionStart = filtered;
  if (Object.keys(hooks).length === 0) delete data.hooks;
  else data.hooks = hooks;

  if (!data.hooks && data.version !== undefined) delete data.version;
  if (Object.keys(data).length === 0) await unlink(hooksJsonPath);
  else await writeHooksJson(hooksJsonPath, data);
  return true;
}

/** Delete the metalmind Cursor hook script. Returns true if the file existed. */
export async function removeCursorHookScript(
  opts: { cursorDir?: string } = {},
): Promise<boolean> {
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const hookScriptPath = join(cursorDir, 'hooks', METALMIND_CURSOR_HOOK_FILENAME);
  if (!existsSync(hookScriptPath)) return false;
  await unlink(hookScriptPath);
  return true;
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter metalmind test -- cursor/hooks.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add cli/src/install/cursor/hooks.ts cli/src/install/cursor/hooks.test.ts
git commit -m "feat(cursor): install latent sessionStart hook"
```

### CHECKPOINT 2 — review the three install primitives (skills, agents, hooks) before the orchestrator.

---

## Task 6: Cursor MCP registration (`cursor/mcp.ts`)

**Files:**
- Create: `cli/src/install/cursor/mcp.ts`
- Test: `cli/src/install/cursor/mcp.test.ts`

Opt-in. Writes a metalmind HTTP entry into `~/.cursor/mcp.json` directly (Cursor
reads `mcp.json`; there is no `cursor mcp add` CLI step to depend on). Read
`cli/src/install/codex/mcp.ts` for the metalmind server URL/shape — reuse the
exact same `url` (`http://127.0.0.1:17317/...`) and server key (`metalmind`).

- [ ] **Step 1: Write the failing test** — `cli/src/install/cursor/mcp.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCursorMcpServer, removeCursorMcpServer } from './mcp.js';

describe('cursor mcp', () => {
  it('adds metalmind server without clobbering existing servers', async () => {
    const mcpJsonPath = join(mkdtempSync(join(tmpdir(), 'mm-cursor-')), 'mcp.json');
    writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: { other: { url: 'x' } } }));
    const result = await addCursorMcpServer({ mcpJsonPath });
    expect(result.action).toBe('added');
    const data = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
    expect(data.mcpServers.other).toBeDefined();
    expect(data.mcpServers.metalmind).toBeDefined();
  });

  it('is idempotent', async () => {
    const mcpJsonPath = join(mkdtempSync(join(tmpdir(), 'mm-cursor-')), 'mcp.json');
    await addCursorMcpServer({ mcpJsonPath });
    const second = await addCursorMcpServer({ mcpJsonPath });
    expect(second.action).toBe('already-present');
  });

  it('removeCursorMcpServer deletes only the metalmind entry', async () => {
    const mcpJsonPath = join(mkdtempSync(join(tmpdir(), 'mm-cursor-')), 'mcp.json');
    writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: { other: { url: 'x' } } }));
    await addCursorMcpServer({ mcpJsonPath });
    const result = await removeCursorMcpServer({ mcpJsonPath });
    expect(result.action).toBe('removed');
    const data = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
    expect(data.mcpServers.other).toBeDefined();
    expect(data.mcpServers.metalmind).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter metalmind test -- cursor/mcp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cli/src/install/cursor/mcp.ts`**

```ts
// Opt-in MCP registration for Cursor (~/.cursor/mcp.json).
//
// metalmind's recall thesis is bash-over-loopback, NOT MCP — this is the
// fallback for users who explicitly want the tool-call shape (--with-mcp).
// Cursor reads mcp.json; we edit it directly, no CLI dependency.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_CURSOR_DIR } from './shared.js';

const METALMIND_MCP_KEY = 'metalmind';
const METALMIND_MCP_URL = 'http://127.0.0.1:17317/mcp';

interface McpJsonFile {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

async function readMcpJson(path: string): Promise<McpJsonFile> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as McpJsonFile;
}

async function writeMcpJson(path: string, data: McpJsonFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export interface CursorMcpOptions {
  mcpJsonPath?: string;
}

export async function addCursorMcpServer(
  opts: CursorMcpOptions = {},
): Promise<{ action: 'added' | 'already-present' }> {
  const mcpJsonPath = opts.mcpJsonPath ?? join(DEFAULT_CURSOR_DIR, 'mcp.json');
  const data = await readMcpJson(mcpJsonPath);
  const servers = data.mcpServers ?? {};
  if (servers[METALMIND_MCP_KEY]) return { action: 'already-present' };
  servers[METALMIND_MCP_KEY] = { url: METALMIND_MCP_URL };
  data.mcpServers = servers;
  await writeMcpJson(mcpJsonPath, data);
  return { action: 'added' };
}

export async function removeCursorMcpServer(
  opts: CursorMcpOptions = {},
): Promise<{ action: 'removed' | 'absent' }> {
  const mcpJsonPath = opts.mcpJsonPath ?? join(DEFAULT_CURSOR_DIR, 'mcp.json');
  if (!existsSync(mcpJsonPath)) return { action: 'absent' };
  const data = await readMcpJson(mcpJsonPath);
  if (!data.mcpServers?.[METALMIND_MCP_KEY]) return { action: 'absent' };
  delete data.mcpServers[METALMIND_MCP_KEY];
  if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
  if (Object.keys(data).length === 0) await unlink(mcpJsonPath);
  else await writeMcpJson(mcpJsonPath, data);
  return { action: 'removed' };
}
```

> **Verify before implementing:** confirm `METALMIND_MCP_URL` matches the URL/port
> `codex/mcp.ts` actually registers. If Codex uses a different path, copy that
> value exactly — do not invent one.

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter metalmind test -- cursor/mcp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/install/cursor/mcp.ts cli/src/install/cursor/mcp.test.ts
git commit -m "feat(cursor): opt-in MCP registration via ~/.cursor/mcp.json"
```

---

## Task 7: Cursor orchestrator + barrel (`cursor/orchestrator.ts`, `cursor.ts`)

**Files:**
- Create: `cli/src/install/cursor/orchestrator.ts`
- Create: `cli/src/install/cursor.ts`
- Test: `cli/src/install/cursor/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test** — `cli/src/install/cursor/orchestrator.test.ts`:

```ts
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installCursor, uninstallCursor } from './orchestrator.js';

describe('installCursor', () => {
  it('installs skills, agents, hook and is reversible', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const result = await installCursor({ vaultPath: '/tmp/v', flavor: 'scadrial', cursorDir });
    expect(result.skills).toContain('metalmind-recall');
    expect(result.agents.length).toBeGreaterThanOrEqual(15);
    expect(result.hookScript).not.toBe('unchanged');
    expect(existsSync(join(cursorDir, 'hooks.json'))).toBe(true);
    expect(result.mcp).toBe('skipped');

    const un = await uninstallCursor({ cursorDir });
    expect(un.skills).toContain('metalmind-recall');
    expect(un.hooksJson).toBe(true);
  });

  it('--with-mcp registers the MCP server', async () => {
    const cursorDir = mkdtempSync(join(tmpdir(), 'mm-cursor-'));
    const result = await installCursor({
      vaultPath: '/tmp/v', flavor: 'scadrial', cursorDir, withMcp: true,
    });
    expect(result.mcp).toBe('added');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter metalmind test -- cursor/orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cli/src/install/cursor/orchestrator.ts`**

```ts
// Cursor install/uninstall orchestrators. Composes the per-section primitives
// in order; uninstall round-trips in reverse. Mirrors codex/orchestrator.ts.

import { join } from 'node:path';
import { copyCursorAgents, removeCursorAgents } from './agents.js';
import {
  applyCursorHooksJson,
  clearCursorHooksJson,
  copyCursorHook,
  removeCursorHookScript,
} from './hooks.js';
import { addCursorMcpServer, removeCursorMcpServer } from './mcp.js';
import { DEFAULT_CURSOR_DIR } from './shared.js';
import { copyCursorSkills, type MetalmindCursorSkill, removeCursorSkills } from './skills.js';

export interface InstallCursorOptions {
  vaultPath: string;
  flavor: 'scadrial' | 'classic';
  withMcp?: boolean;
  templatesDir?: string;
  cursorDir?: string;
}

export interface InstallCursorResult {
  skills: MetalmindCursorSkill[];
  agents: string[];
  hookScript: 'created' | 'updated' | 'unchanged';
  hooksJson: 'changed' | 'unchanged';
  mcp: 'added' | 'already-present' | 'skipped';
}

export async function installCursor(opts: InstallCursorOptions): Promise<InstallCursorResult> {
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const shared = { templatesDir: opts.templatesDir, cursorDir };

  const skills = await copyCursorSkills({ flavor: opts.flavor, ...shared });
  const agents = await copyCursorAgents(shared);
  const hookScript = await copyCursorHook({ flavor: opts.flavor, ...shared });
  const hooksJson = await applyCursorHooksJson({
    hooksJsonPath: join(cursorDir, 'hooks.json'),
    hookCommand: hookScript.hookCommand,
  });

  let mcp: InstallCursorResult['mcp'] = 'skipped';
  if (opts.withMcp) {
    const result = await addCursorMcpServer({ mcpJsonPath: join(cursorDir, 'mcp.json') });
    mcp = result.action;
  }

  return {
    skills: skills.copied,
    agents: agents.copied,
    hookScript: hookScript.action,
    hooksJson: hooksJson.changed ? 'changed' : 'unchanged',
    mcp,
  };
}

export interface UninstallCursorOptions {
  cursorDir?: string;
  removeMcp?: boolean;
}

export interface UninstallCursorResult {
  skills: MetalmindCursorSkill[];
  agents: string[];
  hooksJson: boolean;
  hookScript: boolean;
  mcp: 'removed' | 'absent' | 'skipped';
}

export async function uninstallCursor(
  opts: UninstallCursorOptions = {},
): Promise<UninstallCursorResult> {
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const removeMcp = opts.removeMcp ?? true;

  const skills = await removeCursorSkills({ cursorDir });
  const agents = await removeCursorAgents({ cursorDir });
  const hooksJson = await clearCursorHooksJson({ hooksJsonPath: join(cursorDir, 'hooks.json') });
  const hookScript = await removeCursorHookScript({ cursorDir });

  let mcp: UninstallCursorResult['mcp'] = 'skipped';
  if (removeMcp) {
    const result = await removeCursorMcpServer({ mcpJsonPath: join(cursorDir, 'mcp.json') });
    mcp = result.action;
  }

  return { skills, agents, hooksJson, hookScript, mcp };
}
```

- [ ] **Step 4: Create the barrel `cli/src/install/cursor.ts`**

```ts
export * from './cursor/orchestrator.js';
export * from './cursor/shared.js';
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter metalmind test -- cursor/orchestrator.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/install/cursor/orchestrator.ts cli/src/install/cursor.ts cli/src/install/cursor/orchestrator.test.ts
git commit -m "feat(cursor): install/uninstall orchestrators"
```

### CHECKPOINT 3 — the install module is complete and self-contained. Review before wiring commands.

---

## Task 8: Wire `stamp` and `init` to dispatch the cursor host

**Files:**
- Modify: `cli/src/commands/stamp.ts` (after the `chosenHosts.includes('codex')` block, ~line 104-129)
- Modify: `cli/src/commands/init.ts` (the equivalent host-dispatch block)

- [ ] **Step 1: Read both dispatch sites**

Run: `grep -n "includes('codex')" cli/src/commands/stamp.ts cli/src/commands/init.ts`
Expected: one match per file — the Codex dispatch block to mirror.

- [ ] **Step 2: Add the cursor branch to `stamp.ts`** after the codex block:

```ts
if (chosenHosts.includes('cursor')) {
  log.step('Cursor');
  const cursorResult = await installCursor({
    vaultPath: vault.vaultPath,
    flavor: config.flavor,
    withMcp: opts.withMcp,
  });
  log.info(`  skills: ${cursorResult.skills.join(', ')}`);
  log.info(`  agents: ${cursorResult.agents.length} copied`);
  log.info(`  hook script: ${cursorResult.hookScript}; hooks.json: ${cursorResult.hooksJson}`);
  log.info(`  MCP server: ${cursorResult.mcp}`);
}
```

Add the import at the top: `import { installCursor } from '../install/cursor.js';`
Match the exact `vaultPath` / `flavor` expressions the codex block uses — if
they differ from the above, copy the codex block's expressions verbatim.

- [ ] **Step 3: Mirror the same branch into `init.ts`** at its codex-dispatch site,
adapting variable names to whatever `init.ts` uses locally.

- [ ] **Step 4: Build + run the stamp/init test suites**

Run: `pnpm --filter metalmind test -- stamp init && pnpm typecheck`
Expected: PASS. Existing claude/codex stamp tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/stamp.ts cli/src/commands/init.ts
git commit -m "feat(cursor): dispatch cursor host from stamp and init"
```

---

## Task 9: Wire `uninstall` and `doctor`

**Files:**
- Modify: `cli/src/commands/uninstall.ts`
- Modify: `cli/src/commands/doctor.ts`

- [ ] **Step 1: Find the codex branches**

Run: `grep -n "codex\|Codex" cli/src/commands/uninstall.ts cli/src/commands/doctor.ts`
Expected: codex uninstall + doctor blocks to mirror.

- [ ] **Step 2: Add the cursor uninstall branch** to `uninstall.ts`, mirroring the
codex branch:

```ts
if (hosts.includes('cursor')) {
  log.step('Cursor');
  const result = await uninstallCursor();
  log.info(`  skills removed: ${result.skills.length}`);
  log.info(`  agents removed: ${result.agents.length}`);
  log.info(`  hook: ${result.hookScript}; hooks.json: ${result.hooksJson}`);
  log.info(`  MCP: ${result.mcp}`);
}
```

Import: `import { uninstallCursor } from '../install/cursor.js';`

- [ ] **Step 3: Add a Cursor health branch** to `doctor.ts`, mirroring the codex
health check — assert `~/.cursor/hooks.json` contains the metalmind entry and
`~/.cursor/skills/metalmind-recall/SKILL.md` exists. Use the exact reporting
helpers (`log.*` / check-row format) the codex doctor branch uses.

- [ ] **Step 4: Run the command suites**

Run: `pnpm --filter metalmind test -- uninstall doctor && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/uninstall.ts cli/src/commands/doctor.ts
git commit -m "feat(cursor): wire uninstall and doctor for the cursor host"
```

---

## Task 10: Ship-file check + full verification

**Files:**
- Modify (if needed): `cli/package.json` `files` array

- [ ] **Step 1: Confirm `cli/templates/` ships**

Run: `node -e "console.log(require('./cli/package.json').files)"`
Expected: array includes `templates`. The new `templates/cursor/` tree ships
automatically — no change needed. If `templates` is absent, add it.

- [ ] **Step 2: Full test suite**

Run: `pnpm --filter metalmind test`
Expected: PASS — all new cursor tests + unchanged claude/codex suites green.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. Fix any `biome` findings at the root cause — never disable a rule.

- [ ] **Step 4: Manual smoke test**

```bash
pnpm --filter metalmind build
HOME=$(mktemp -d) node cli/dist/cli.js stamp --host cursor --no-prompt
```
Expected: a `~/.cursor/` (the temp HOME) with `skills/metalmind-recall/SKILL.md`,
15 files in `agents/`, `hooks/metalmind-cursor-session-start.sh`, and a
`hooks.json` with a `sessionStart` entry.

- [ ] **Step 5: Run the hook script in isolation**

```bash
echo '{"hook_event_name":"sessionStart"}' | bash ~/.cursor/hooks/metalmind-cursor-session-start.sh
```
Expected: valid JSON with an `additional_context` key (snake_case).

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "test(cursor): full-suite verification for the cursor host port"
```

### CHECKPOINT 4 — full verification complete. Ready for `/ship`.

---

## Open items carried from the spec (not blocking)

1. **Live-shape verification** — whether `cursor-agent --print --output-format json`
   can assert the recall skill is surfaced. If scriptable, add to Task 10; if not,
   the Step 4-5 manual smoke is the documented substitute.
2. **`metalmind-recall` description tuning** — the Task 2 `description` wording is
   a first draft. Add a `cli/skills-evals/metalmind-recall/` eval case in a
   follow-up to confirm auto-invocation precision.
3. **Windows `sessionStart`** — out of scope, macOS-first.

## Self-review

- **Spec coverage:** every spec artifact maps to a task — recall skill (T2-3),
  latent hook (T2,T5), skills (T3), 15 agents (T4), opt-in MCP (T6), host wiring
  (T1,T8-9), tests + boundaries (every task + T10). ✓
- **Placeholders:** none — every code step carries complete code; "mirror codex/X"
  references point to real, readable committed files, not other plan tasks.
- **Type consistency:** `MetalmindCursorSkill` defined in T3 and consumed in T7;
  `installCursor`/`uninstallCursor` signatures consistent T7→T8-9;
  `cursorDir`/`templatesDir` option names uniform across all primitives.
