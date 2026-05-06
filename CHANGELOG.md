# Changelog

All notable changes to metalmind are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

The single source of truth for a release is the git tag and the published [npm package](https://www.npmjs.com/package/metalmind). This file summarizes the **why** for each release; the commit log has the full **what**.

---

## 0.8.0 — 2026-05-06

### Added — Codex CLI is now a first-class metalmind host

`metalmind init --host codex` (or selecting "Codex CLI" in the new multi-select prompt) stamps Codex with the same recall-first behaviour Claude Code gets. The seven artifacts:

- `~/.codex/AGENTS.md` — sentinel-bounded recall instructions Codex injects on every turn (wrapped in `<INSTRUCTIONS>`).
- `~/.codex/hooks.json` SessionStart entry + `~/.codex/hooks/metalmind-session-start.sh` — **reuses the existing CC hook script verbatim**. Codex's hook payload (JSON shape, `additionalContext` field) is byte-identical to Claude Code's, verified via the openai/codex Rust binary strings + the CC→Codex migration logic in `app-server/src/config/external_agent_config.rs`.
- `~/.codex/config.toml` `[sandbox_workspace_write] network_access = true` (sentinel-bounded) — Codex's default workspace-write sandbox blocks loopback; without this stamp, every recall fails with a sandbox network proxy denial.
- `~/.codex/rules/metalmind.rules` — Starlark `prefix_rule(...)` allows for the entire metalmind CLI surface, so the first recall in a fresh Codex workspace doesn't hit an escalation prompt. Verified path against `codex-rs/core/src/exec_policy.rs:51,575,763,988`.
- `~/.codex/skills/{writing-vault-notes,synod,save}/` — same skill discipline as CC; Codex's SKILL.md frontmatter is identical.

### Added — opt-in `--with-mcp` for Codex MCP registration

Default install registers no MCP server in Codex (zero standing token cost — matches the v0.7.0 site headline). Users who want explicit tool-call ergonomics pass `--with-mcp` to run `codex mcp add metalmind --url http://127.0.0.1:17317/mcp`. Trade-offs documented in `docs/cookbook-codex.md`.

### Added — host multi-select prompt

`metalmind init` and `metalmind stamp` always show a multi-select of detected hosts (`~/.claude/`, `~/.codex/`) so newly-installed hosts surface for opt-in. Decision: never silently dual-install. `--host claude|codex|both` bypasses the prompt; `--no-prompt` reuses the previously-chosen set (CI / scripted re-stamps).

### Added — `metalmind doctor --deep` per-host check matrix

`runDeepChecks` gates per host. New `checkCodexInstall` returns 6 (or 7 with MCP) DeepCheck entries: AGENTS.md sentinel · hook script · hooks.json registration · network_access · prefix rules · skills · (optional) MCP server. CC checks unchanged.

### Added — `metalmind uninstall` round-trips Codex

Detects Codex install footprint from `config.hosts` OR from on-disk sentinel files (best-effort cleanup). Pre-confirm summary names every Codex artifact that will be removed; explicit "Will NOT touch" callout for `~/.codex/memories` and `~/.codex/rules/default.rules`. After uninstall, `grep -r metalmind ~/.codex/` returns empty (excluding `default.rules`, which is Codex-managed).

### Changed — `/save` body extracted to a shared partial

`cli/templates/.shared/save-body.md` is the new single source of truth for the save workflow. Both CC's `commands/save.md` (slash command, keeps `$ARGUMENTS` tail) and Codex's `skills/save/SKILL.md` (description-triggered skill) source from it via a `{{> .shared/save-body.md}}` preprocessor. Snapshot test (`save-snapshot.test.ts`) asserts CC `save.md` is byte-identical to v0.7.x output. Codex/CC body byte-equality test asserts the partial sources match in both consumers.

### Changed — Codex skill rendering applies flavor + skill sentinels

Bug fix introduced in Phase 1 development: `copyCodexSkills` now runs `renderFlavorSentinels` and `renderSkillSentinels` through the render chain. Previously synod's `flavor-classic` / `flavor-scadrial` sentinel pairs were both written to disk. Tests assert the strip in both directions.

### Boundaries

- metalmind never writes to `~/.codex/memories/` (Codex's native memory; orthogonal).
- metalmind never touches `~/.codex/rules/default.rules` (Codex's user-acceptance log — Codex appends to it when you click "Allow + Remember" in the TUI).
- using-teams skill remains CC-only (depends on TeamCreate tool that Codex doesn't have).
- **Codex desktop app** (`codex app`) is on the v1.1 roadmap; v0.8.0 covers Codex CLI only.

### Behaviour changes

- `Config` schema gains `hosts: ('claude' | 'codex')[]`. v0.7.x configs migrate to `['claude']` on first read via Zod `.default(['claude'])`. Existing CC-only users see no behavioural change until they re-stamp.
- `metalmind stamp` now re-prompts for hosts on every invocation (decision A: always show). `--no-prompt` skips and reuses `config.hosts`.

### Reference

- Vault plan: `Plans/2026-05-06-codex-host-integration-impl.md` — full implementation plan
- Vault plan: `Plans/2026-05-06-2026-05-06-metalmind-codex-host-integration.md` — research record (Codex surfaces, prefix_rule path discovery)
- Cookbook: [`docs/cookbook-codex.md`](docs/cookbook-codex.md)

---

## 0.7.0 — 2026-05-05

### Changed — repositioned as the Claude Code standard library

metalmind isn't "memory for Claude Code with extra workflow features bolted on." It's six integrated modules, each closing a gap Claude Code itself doesn't fill. **Memory** is the headline because it's the most legible benchmark and the most universal need. **Code intelligence** (cross-repo graph, symbol nav, coordinated rename), **daily workflow** (atium / gold / EOD routine), **deliberation** (synod), **desktop integration** (flare), and **health** (pulse, recall-audit) ship with it. The integration is the moat.

This release is the positioning shift — no behaviour changes, no breaking changes, no code touched in `cli/src/` or `packages/vault-rag/`. The four-rule honesty bar that keeps the library from drifting into a kitchen sink is now stated explicitly:

1. Zero standing MCP-schema tax in Claude Code.
2. Reversible to zero — `metalmind uninstall` never touches your notes.
3. No accounts, no cloud, no third-party services.
4. Closes a gap Claude Code itself doesn't fill — no duplication of host primitives.

### What changed (content only)

- **Site landing page** (`site/src/pages/index.astro`):
  - Hero copy reframed: *"the missing standard library for Claude Code"*.
  - New **What's in the standard library** section after *What it's actually for*, listing the six modules + the four-rule bar.
  - Page TOC includes the new section.
  - **`/memory` column added** to the *How metalmind compares* matrix, with a new **Cross-repo** row that flips the comparison cleanly: native `/memory` is the zero-install baseline; metalmind earns its install cost once knowledge crosses repo boundaries.

- **Repo-root `README.md`**:
  - Hero paragraph reframed to match the site.
  - New **What's in the standard library** module table + four-rule bar.
  - **`## What it adds`** restructured into module sections (`### Memory`, `### Code intelligence`, `### Daily workflow`, `### Deliberation`, `### Desktop integration`, `### Health`) — same content, organised by module instead of a flat bullet list.
  - **`/memory` column added** to the comparison matrix; new *Cross-repo* row.
  - Docs section links the two new docs (architecture, cookbook).

- **`cli/README.md`**: one-paragraph intro that frames the CLI as the surface every module ships through. Internal contributors share the framing.

- **`bench/recall-v0/README.md`, `bench/mcp-tax-v0/README.md`, `bench/recall-at-scale/README.md`**: each gets a one-line callout placing it in the standard-library framing (*memory module*, or in the case of mcp-tax, *the foundational rule*).

- **`docs/architecture.md`** *(new)*: single-page architectural overview — six modules, four pieces of shared state (vault / sentinel-bounded stamps / watcher + recall HTTP / CLI), how they wire together, and the criteria for adding a new module. Includes an ASCII diagram.

- **`docs/cookbook.md`** *(new)*: opinionated patterns for using metalmind well. v0 covers three sections — *Writing a vault note Claude will find* (frontmatter discipline, kind:slug shortcuts, MOC linking, anti-patterns), *Recall hygiene* (when `--deep` vs `--expand`, the 2–3 rephrasings rule, reading the recall log), and *What lives where* (per-folder intent + the decision question). Two sections deferred to a v1 cookbook (*Migrating from mem0/Letta/Notion*, *Scaling past 10k notes*).

### What didn't change

- **No code touched.** `cli/src/`, `packages/vault-rag/`, all tests pass unchanged. 317/317 tests green; typecheck clean; site build clean.
- **No new commands.** Every existing verb still works exactly as before.
- **No breaking changes.** Existing scripts, existing skill templates, existing stamped blocks all keep their contracts.
- **No version bump in `metalmind-vault-rag`.** Stays at 0.3.0.

### Migration

Run `metalmind stamp` after upgrade — but no template content changes between v0.6.2 and v0.7.0, so the stamp is a no-op for stamped files. The new docs (`docs/architecture.md`, `docs/cookbook.md`) ship in the npm tarball and are linked from the README.

### Why a medior-version bump for a content-only release

The standard-library framing is a real product-positioning shift you'll want a public marker for. Every module-naming and the four-rule bar are now things future contributors will reference. A patch (0.6.3) would imply "tiny fix"; this is a deliberate repositioning — last-digit bump would understate it.

---

## 0.6.2 — 2026-05-05

### Fixed — vault `CLAUDE.md` block aligned with the global block

v0.6.1 closed the contradictions between the **global** stamped block (`~/.claude/CLAUDE.md`) and the CLI contract, but missed the **vault** stamped block (`<vault>/CLAUDE.md`). The two stamped surfaces ended up contradicting each other in four places. v0.6.2 closes the gap.

#### Vault-template contradictions fixed

`cli/templates/vault/CLAUDE.md.block.template`:

1. **Folders list mismatched the global block.** Vault listed `Work/ · Personal/ · Learnings/ · Daily/ · Inbox/ · Archive/ · Memory/` — missing `Plans/` and `Work/MOCs/`. Global (post-v0.6.1) lists all nine. Aligned.
2. **Direct contradiction on where writes are allowed.** Vault block said "Write only to `Inbox/`, `Daily/`, or a note the user names." Global block (post-v0.6.1) says scribe handles all CRUD across every kind. The vault rule was overly restrictive and predated scribe-as-only-write-tool. Replaced with: every vault write goes through metalmind (scribe / atium / gold); no raw `Write`/`Edit`; if no command fits, stop and surface the gap.
3. **No reference to scribe in the vault `Writing` section.** The section title was literally `Writing` with the verb `Write` and never named scribe. Now references the metalmind write surface and points at the global block for the full contract.
4. **MOC location contradiction.** Vault said "MOCs live at `<Folder>/MOCs/<topic>.md`" (per-folder). Global says "matching MOC at `Work/MOCs/<project>.md`; no per-project subfolders." Aligned to the global rule.

### Migration

Run `metalmind stamp` after upgrade so the vault block in `<vault>/CLAUDE.md` picks up the new contract. The managed sentinel block is rewritten in place; user content outside the markers is preserved.

### Site/README drift fix

Bumped `current release` reference in `README.md` to v0.6.2.

---

## 0.6.1 — 2026-05-05

### Fixed — stamped rules no longer contradict the metalmind CLI contract

The stamped rule surface (top-of-file `CLAUDE.md` block, `/save` skill, `writing-vault-notes` skill, daily-note flow) had drifted from the actual CLI behaviour in nine places. Each gap was a way for an agent reading the rules to either bypass metalmind ("write directly with `Write`") or hit a silent footgun ("wrote a daily note for the wrong date"). This release closes all nine and adds the one CLI-side guard the rule surface now depends on.

#### Fixed + Breaking — scribe daily-date guard

Every mutating `metalmind scribe` verb (`create`, `update`, `patch`, `delete`, `archive`, `rename`) now **refuses** to touch a daily note (`Daily/YYYY-MM-DD.md`) when the target date ≠ today, unless `--date <today|tomorrow|next-workday|YYYY-MM-DD>` is passed to acknowledge the target date explicitly. The error names today, names the resolved target, and prints the exact flag invocation that would have worked. For daily action items the canonical path remains `metalmind atium add --date <date>`.

Previously: `scribe update daily:2026-05-06` either silently succeeded or failed with a generic `note not found`, with no signal that today was the intended target. **Breaking** for any script that relied on the silent behaviour — the migration is mechanical: if your script genuinely targets a non-today daily note, add `--date <YYYY-MM-DD>`. If it didn't, the new error tells you the bug existed already. There is no flag to opt out of the guard — silent footguns hide behind flags.

#### Stamped-rule contradictions fixed

`cli/templates/claude/CLAUDE.md.block.template` (top-of-file block stamped into every install's `~/.claude/CLAUDE.md`):

1. **Verb list was incomplete and mixed mutating with read-only.** Previously listed `<create|update|patch|delete|archive|list|show>` and claimed "all verbs support `--dry-run`" — but `rename` was missing, and `list`/`show` are read-only (no `--dry-run`). Now: mutating verbs and read-only verbs are split into separate bullets; `rename` is included; `--dry-run` claim is scoped correctly.
2. **Folder list was missing `Plans/` and `MOCs/`.** Both are valid scribe kinds (`plan:`, `moc:`); the canonical folder list now includes them.
3. **Daily-date contract was absent.** New paragraph names the guard, documents `--date`, and points at `metalmind atium add` as the canonical path for daily action items.
4. **Daily-shortcut example was missing.** Examples now show `daily:2026-04-21` alongside `learning:` / `plan:`, with a callout that non-today dates need `--date`.
5. **"No `Write` fallback" rule was only in `/save`.** Lifted into the top-of-file block — every Claude Code session reads `CLAUDE.md`; only the `/save` flow reads `save.md`. The rule now lives where it's most needed: "if no metalmind command fits your target, **stop and surface the gap** — do not reach for `Write` as a fallback."
6. **Hardcoded `~/Knowledge/` path.** Replaced with `{{VAULT_PATH}}` placeholder so the stamped rule is correct for users with non-default vault locations.

`cli/templates/claude/commands/save.md`:

7. **Daily routing was ambiguous.** "Append to today's daily log" line didn't say which tool to use. Now spells out: `metalmind atium add` for action items, `scribe update daily:<today>` for prose; non-today requires `--date` on both surfaces.

`cli/templates/claude/skills/writing-vault-notes/SKILL.md`:

8. **Write-surface table conflated daily and non-daily.** The table now has separate rows for "Note CRUD — mutating" / "Note CRUD — read-only" / "Daily action items (canonical)" / "Daily prose for non-today date" — matching the actual CLI surfaces an agent reaches for.
9. **Old "future daily notes go through atium, scribe errors on --slug" paragraph was stale** (only described half the contract). Replaced with the full daily-date guard paragraph: which verbs refuse, which flag overrides, which surface is canonical for which intent.

### What changed

- `cli/src/scribe/scribe.ts` — added `assertDailyDateAck`, threaded `date?: DateArg` through `CreateOpts`, `scribeUpdate`, `scribePatch`, `scribeDelete`, `scribeArchive`, `scribeRename`. `scribeCreate` for `kind=daily` now accepts `--date` to land the file at a non-today date; `--slug` for kind=daily errors with a pointer to `--date` or `metalmind atium new`.
- `cli/src/cli.ts` — `--date <date>` flag added to `scribe create | update | patch | delete | archive | rename` (and classic aliases under `note`). Help text shared via a single description string.
- Three template rewrites described above.
- Tests: `cli/src/scribe/scribe.test.ts` adds 9 cases under `describe('daily-date guard')` covering create-with-date, update-without-ack-refuses, mismatched-date error shape, patch/archive guard paths, today-still-works, and non-daily-unaffected.

### Site/README drift fix

Bumped the `current release` reference in `README.md` to v0.6.1 (was lagging at v0.5.3 since the v0.5.4–v0.6.0 batch). The site already pulls from `cli/package.json`.

### Migration

Run `metalmind stamp` after upgrade so the rule and skill templates propagate to every existing install. Scripts that hit a daily note via scribe for non-today dates will start erroring; the error message prints the exact fix.

---

## 0.6.0 — 2026-05-03

### Added

- **`synod` skill + `metalmind synod <question>` command.** Convenes a 7-persona deliberative council to debate substantive engineering and strategic decisions — architecture choices, technology bets, large refactors, build-vs-buy calls, team/process changes — and also non-engineering judgement calls (career, business, life). Each persona is spawned as a parallel subagent (Adversary, Strategist, Scientist, Visionary, Engineer, Philosopher, Humanist), the main agent synthesises a structured verdict (position, confidence %, 3 critical risks, 5 next steps, minority report). Pulls vault context via `{{RECALL_CMD}}` before debating; proposes persisting the verdict via `metalmind scribe` after. Carved out from `code-review`, `team-debug`, `ai-dev-tool-analyzer`, and `brainstorming` for *tactical* work (a single PR, one bug, comparing two specific libs, in-flight implementation) — synod is for the questions that affect the next 6 months, not the next 60 minutes. The CLI command shells out to `claude -p` so it works from a plain terminal.
- **Scadrial flavour for `synod`.** Personas ship as Kelsier's crew when `metalmind init` is run with `--flavor scadrial` (default): Kelsier, Breeze, Sazed, Vin, Clubs, Ham, Dockson. Classic flavour keeps the generic role names. Selection is install-time via the new `renderFlavorSentinels` substitution in `cli/src/install/templates.ts` — the chosen branch is baked into the persona files on disk; the other branch is stripped entirely. No runtime flavour detection inside the skill.

---

## 0.5.7 — 2026-05-02

### Fixed

- **`graphify claude install` no longer pollutes `~/CLAUDE.md`.** Earlier metalmind versions ran the command with cwd = `$HOME`, which caused graphify to write a `~/CLAUDE.md` stamp. Claude Code walks parent directories looking for `CLAUDE.md`, so a file at `$HOME` injects graphify-specific instructions ("read `graphify-out/GRAPH_REPORT.md`", etc.) into every session under `$HOME` — including unrelated repos that don't even have a graphify graph. metalmind now spawns graphify from a throwaway temp directory; the useful side-effect (the conditional `PreToolUse` hook in `~/.claude/settings.json`, which only fires when `graphify-out/graph.json` exists in the cwd) still gets wired correctly. The `--no-graphify` opt-out is unchanged.
- **Legacy cleanup on every `init`.** If you have a stale `~/CLAUDE.md` containing only a `## graphify` section from an earlier metalmind version, it gets removed automatically. If the file has other content alongside the graphify block, only the graphify section is stripped — the rest is preserved.

---

## 0.5.6 — 2026-05-02

### Fixed

- **`metalmind init --yes` no longer silently disables agent teams.** In 0.5.5 the `--yes` default for teams was `false` while the interactive prompt's default was `true`. After 0.5.5 made `applyAgentTeams({ enable: false })` actively *clear* the keys (rather than just skip writing), passing `--yes` to a working setup wiped the agent-teams config out of `~/.claude/settings.json`. Default is now `true` to match the interactive prompt and the other `--yes` defaults (`vaultGit`, `autoInstallUv`). Use `--no-teams` to opt out explicitly.

If you ran `metalmind init --yes` on 0.5.5 and noticed your team setup stopped working, re-run `metalmind init --yes` on 0.5.6 (or `metalmind init --yes --teams` on 0.5.5) — the keys come back idempotently.

---

## 0.5.5 — 2026-05-02

Fresh-laptop fixes. Anyone who hit the prereq wall, the `init`-from-`/` crash, or the dead agent-teams flag in 0.5.4 should upgrade.

### Fixed

- **Agent teams now actually enable.** Previously `--teams` (and the wizard prompt) wrote `teammateMode: "auto"` to `~/.claude.json`. That's the wrong file *and* the wrong value. Per the [official docs](https://code.claude.com/docs/en/agent-teams), agent teams require **both** keys, and **both** live in `~/.claude/settings.json`:
  ```json
  { "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }, "teammateMode": "tmux" }
  ```
  metalmind now writes both, idempotently, and `metalmind uninstall` clears both. Users who previously said yes to teams will need to re-run `metalmind init` (or `metalmind stamp`) to pick up the working config.
- **`graphify claude install` no longer crashes when run from a read-only cwd.** Running `metalmind init` from `/` (or any directory the user can't write) made `graphify claude install` try to write `/CLAUDE.md`, hitting `OSError: Read-only file system`. The graphify spawn is now pinned to `$HOME` so the stamp lands in `~/CLAUDE.md` regardless of where you ran the wizard from.

### Added

- **uv auto-install in `init`.** uv is the only metalmind prereq with a sanctioned one-line installer. When it's missing, the wizard now prompts to run `curl -LsSf https://astral.sh/uv/install.sh | sh`, then prepends `~/.local/bin` to `PATH` for the rest of the install so the freshly-installed binary is found without restarting the shell. Skipped via `--no-auto-install-uv`. Default-yes under `--yes`.

### Notes

- `~/.claude.json` may still have a stale `teammateMode` from older metalmind releases. We don't strip it — Claude Code historically mirrored the field there, and removing user state we no longer manage is the wrong default. The authoritative copy is in `settings.json`.

---

## 0.5.4 — 2026-05-02

Quality-of-life pass on `init` and `doctor`. No behaviour change for existing installs.

### Added

- **Vault git tracking in `init`.** New prompt asks whether to track the vault as a git repo. On yes, runs `git init`, writes a sentinel-bounded `.gitignore` block (Obsidian per-machine state, trash, sqlite cache files), and makes an initial commit. Idempotent — re-running `init` on an already-tracked vault only refreshes the managed `.gitignore` block. Never touches remotes; prints the `git remote add origin <url>` hint so the user picks the host.
- **CLI flags:** `--git` / `--no-git` on `metalmind init`. Default-yes under `--yes`.
- **Obsidian detection in `doctor`.** Informational line in the Config block: detects `Obsidian.app` on macOS (`/Applications` and `~/Applications`), `~/.config/obsidian` / Flatpak / snap on Linux, and AppData paths on Windows. Never blocks, never fails — prints a platform-appropriate install hint when not found. metalmind doesn't install Obsidian and doesn't intend to: the vault is plain markdown, Obsidian is one viewer of many.

### Why these two together

If you've ever rebuilt a dev laptop you know the answer: a vault you've been editing for months should not start its life on the new machine as an un-versioned folder, and `metalmind doctor` should tell you whether you have a GUI to view it with. Both are 30-second tasks that nobody does.

### What stays the same

- Existing installs are unaffected — `init` is the only entry point that prompts for git tracking, and re-running it on a tracked vault is a no-op except for the managed `.gitignore` block.
- No changes to `metalmind-vault-rag` (still 0.3.0). No re-embed.

---

## 0.5.3 — 2026-05-01

ONNX-based reranker. `[rerank]` extra drops from ~2 GB to ~210 MB (~9× smaller install). Same model (BAAI's `bge-reranker-v2-m3`), same scoring shape, same public API on the rerank module — the watcher and the CLI don't notice.

`metalmind-vault-rag` bumps to 0.3.0 (breaking — the `[rerank]` extra changed shape; users with the extra installed need a `metalmind stamp` to get the new deps).

### What changed under the hood

- **Out:** `FlagEmbedding>=1.3` + `transformers<5` + transitive `torch` (~700 MB by itself, ~2 GB total install).
- **In:** `onnxruntime>=1.17` + `tokenizers>=0.15` + `huggingface_hub>=0.20` (~60 MB total). Native binaries, no Python ML framework dragged in.
- **Model:** `onnx-community/bge-reranker-v2-m3-ONNX` (HF community ONNX export of the same BAAI model, `model_quantized.onnx`, ~150 MB on first download). Override via `METALMIND_RERANKER_MODEL` and `METALMIND_RERANKER_ONNX_FILE` env vars.

### What stays the same

- `rerank.is_dep_available()` / `rerank.overfetch_k(k)` / `rerank.rerank_hits(query, hits, k)` keep the exact same signatures — the `/rerank/status` endpoint, the bench's pre-flight check, and the CLI's auto-bootstrap on first `--rerank` all work without changes.
- Recall quality is the same model, so hit@K is unchanged on the bench fixtures (verified at 100 notes: hybrid+rerank still hits @5 = 95%).
- Failure mode unchanged — when ONNX deps are missing or download fails, rerank silently falls back to embedder ordering. Recall must never fail because rerank failed.

### What you need to do

- **Default install (no `[rerank]`):** nothing — the default install stays slim and never had FlagEmbedding.
- **You opted into `[rerank]` previously:** run `metalmind stamp` (or `metalmind init` again). The version bump triggers a force-reinstall of the vault-rag tool venv with the new lean deps. About to save you ~1.8 GB on disk.

### Tests + bench

- New CI canary in `tests/test_rerank_compat.py` asserts (a) the ONNX deps import cleanly and (b) `torch` is NOT importable in a process that only has `[rerank]` installed — pinned guard against future transitive regressions pulling torch back in.
- `bench/recall-v0/` and `bench/recall-at-scale/` runners updated to print the right diagnostic when ONNX rerank deps are missing.

---

## 0.5.2 — 2026-05-01

Site polish + recall-quality self-audit + scale bench. `metalmind-vault-rag` bumps to 0.2.1 for the recall-log surface; CLI re-stamp pulls it on next `metalmind init`.

### Site — unified layout, Classic default

Three layout regressions had crept in around the v0.5.x bench-table refresh: section widths drifted across `.container` (720), `.container-wide` (1180), and an interim `.section-wide` (1200 with prose cap), which made adjacent section headings sit on different left edges. Widening the rail without a sidebar produced empty right columns. The install-flow rail anchored to the wide left edge and looked broken.

Collapsed to one layout primitive: every section on every page lives in a 960px centered column. `.container` and `.container-wide` both resolve to `--page-max`; `.section-prose` is a no-op pass-through to keep markup compiling. Hero is the only `text-align: center` exception.

Also: `flavor-classic` is now the default radio + the static-default CSS state, so the first paint already shows the Classic vocabulary instead of flashing Scadrial first. The toggle still works either direction.

### Site content — positioning matrix

Added a `How metalmind compares` section to the landing page and README. Side-by-side on shape, not numbers (memory primitive, source preservation, recall determinism, transport, standing tokens in Claude Code, where state lives, walk-away cost) across metalmind / qmd / mem0 / Letta / Mastra. Honest framing: Letta and Mastra are agent frameworks (different category), so their rows say "different host model" rather than overclaiming a metalmind win.

### `metalmind doctor --recall-audit` — opt-in self-audit

First memory tool in the category that tells you when *recall itself* is failing you. Two parts:

- **Watcher (Python):** new `recall_log.py` module, append-only NDJSON writer gated by `METALMIND_RECALL_LOG_PATH` (default off — no logging unless the env is set). The HTTP `/search` path records one line per query: `ts`, `query`, `mode`, `rerank` flag, `k`, hit count, top file basenames, top score.
- **CLI:** `metalmind doctor --recall-audit` (and `pulse --recall-audit`) reads the log, classifies each entry as `ok` / `weak-hit` (top score < 0.3) / `zero-hit` (no hits), and prints the top 25 unique candidates ranked by frequency for `/save` follow-up. `--recall-audit-days <n>` controls the window (default 7).

Privacy: the log lives at `~/.metalmind/recall-log.ndjson` on disk only, opt-in by env var, never leaves the machine.

### `bench/recall-at-scale/` — 1k / 10k / 50k

Sister bench to `recall-v0`. Validates whether the embedded sqlite-vec + fastembed pipeline holds recall quality at large vault sizes — the prerequisite for ever removing the `--legacy` escape hatch. Three pieces:

- **`scripts/fetch-hn.mjs`** pulls comments from the public HN Algolia mirror in 14-day windows (works around Algolia's `page * hitsPerPage <= 1000` cap), caches at `~/.cache/metalmind-bench/hn/` outside the repo. Idempotent and resumable.
- **`scripts/seed-gold.mjs`** deterministically picks 20 stories with ≥5 cached comments. Query is a templated paraphrase of the story title; expected = every cached comment in that story (honest "give me anything from the thread about X" matching, not a single-doc lottery).
- **`run.mjs`** mirrors the recall-v0 lifecycle (per-scale isolated tmp vault, dedicated watcher on isolated port, indexer one-shot, query, signal-safe teardown) but drops the bm25/qmd parallel scorers — just metalmind hybrid + optional `--rerank`.

Numbers on the embedded backend (no rerank), 16-thread M-series Mac:

| scale | hit@1 | hit@3 | hit@5 | misses | index (s) | p50 (ms) | p95 (ms) |
|---|---|---|---|---|---|---|---|
| 1,000 | 100% | 100% | 100% | 0/20 | 33 | 12 | 24 |
| 10,000 | 100% | 100% | 100% | 0/20 | 1226 | 40 | 67 |

50k row pending — indexer takes ~100 min and is left as an unattended-run follow-up. The 10× scaling at constant 100% hit@1 already validates the embedded pipeline; 50k is confirmation, not signal.

---

## 0.5.1 — 2026-04-30

Polish + bench column release. No watcher-side / Python-side changes — `metalmind-vault-rag` stays at 0.2.0, no re-stamp needed unless you want the cleaner CLI messaging.

### Cleanup — gate Docker/Ollama on `--legacy`

The v0.5.0 release flipped the default install to sqlite-vec + fastembed, but several CLI surfaces still assumed Docker. Fixed:

- **`metalmind doctor --deep`** now skips the `metalmind-qdrant` / `metalmind-ollama` / qdrant-collection / ollama-model checks unless those containers are actually running. Default-install users see four checks (watcher + recall HTTP + sentinels) instead of seven, four of which always failed.
- **`metalmind uninstall`** hides the "stop watcher and Docker stack" copy and the "Remove Docker volumes (~274 MB)?" prompt when no `<vault>/.metalmind-stack/compose.yml` exists.
- **`metalmind init`** wizard log now prints `Embedded backend (sqlite-vec + fastembed) — no Docker stack needed` instead of the stale `Skipping Docker stack` warning when running the default path.

### Docs sweep — embedded by default

`docs/prerequisites.md`, `docs/post-install.md`, `docs/customization.md`, `bench/recall-v0/README.md`, the site's `InstallFlow` component — all rewritten to lead with the in-process stack. Docker / Ollama / `nomic-embed-text` references kept only where they're accurate (historical changelog entries, `--legacy` callouts). The site's "Install flow" diagram step 4 went from "Local stack (Qdrant + Ollama containers)" to "In-process retrieval stack (sqlite-vec + fastembed, no Docker)".

### qmd as a bench column

`bench/recall-v0/run.mjs` now runs [qmd 2.1.0](https://github.com/tobi/qmd) alongside the metalmind columns on the same 12 gold + 988 distractor fixture. Adapter at `bench/recall-v0/scripts/qmd.mjs` drives qmd via `npx -y @tobilu/qmd@latest` so the bench has zero global-install commitment. Per-scale isolation needs both `INDEX_PATH` (sqlite DB) and `QMD_CONFIG_DIR` (the YAML collection registry qmd writes to `~/.config/qmd/index.yml` independent of the index file).

Numbers on the shared fixture (4 scales, 20 queries, with rerank):

| metric @ 1,000 notes | metalmind +rerank | qmd 2.1.0 |
|---|---|---|
| hit@1 | **90%** | 80% |
| hit@5 | **95%** | 90% |

| metric @ 100 notes | metalmind +rerank | qmd 2.1.0 |
|---|---|---|
| hit@1 | **90%** | 70% |
| hit@5 | 95% | **100%** |

Both pull ~2 GB of model weights. qmd has more hit@5 headroom at small scales from its fine-tuned 1.7B query expansion; metalmind has consistently better hit@1 across the curve after the v0.4.0 weighted-RRF fix. Side-by-side in the README + on the site landing page.

### Methodology — mem0 doesn't fit a head-to-head bench

`Learnings/mem0-vs-metalmind-shape-mismatch.md` (in the vault, linked from the metalmind MOC) explains why mem0 isn't on the bench: it's LLM-in-the-loop fact extraction, not file retrieval, so the source-document mapping the bench scores against doesn't exist. The fair comparison is positioning, not numbers — covered in that note.

---

## 0.5.0 — 2026-04-30

### Added — single-binary install (sqlite-vec + fastembed)

Both daemons are gone. `metalmind init` no longer requires Docker or Ollama; the vector store and the embedding model both run in-process inside the Python venv that `uv tool install metalmind-vault-rag` creates. Five prereqs replace seven: Python, uv, git, Claude Code, Node — that's it. Pass `--legacy` to opt back into the Qdrant + Ollama Docker stack.

- **`VectorStore` Protocol** in `metalmind_vault_rag/stores/`. Two impls behind it: `QdrantStore` (legacy) and `SqliteVecStore` (new default). `vec0` virtual table at `~/.metalmind/vec-<col>.db` with cosine distance metric; payloads in a SQLite side-table joined on rowid; per-thread sqlite3 connections so the `ThreadingHTTPServer` doesn't trip the same-thread guard.
- **`EmbeddingBackend` Protocol** in `metalmind_vault_rag/backends/`. Two impls: `OllamaBackend` (legacy) and `FastEmbedBackend` (new default). Default model `BAAI/bge-small-en-v1.5` (384-dim, ~30 MB ONNX, cached at `~/.cache/fastembed/`). Tunable via `VAULT_EMBED_MODEL`.
- **`METALMIND_BACKEND=embedded` (default) | `legacy`** picks both at once. Same env var across stores and backends so the two halves can never mismatch.
- **Auto-backfill on watcher startup**. `_maybe_backfill` detects either store empty + source files present and runs a one-shot reindex. Covers both upgrade paths (v0.4.x → v0.5.0 and the original v0.2.x → v0.3.0+ FTS5 case) in one helper.
- **Init wizard simplified**. `detectPrereqs` now takes `{ includeDocker }`; default false. Wizard threads the option from `opts.skipDocker` so the Docker check fires only when the legacy stack will actually run.

### Result on the scaled recall bench (1,000 notes)

The new stack outperforms v0.4.0 on every measured dimension because `bge-small-en-v1.5` is a stronger embedding model for English factual retrieval than `nomic-embed-text`:

- **hit@1 hybrid: 65% → 85%** (+20pp). Pure-semantic hit@5 jumped from 55% → 90% just from the model swap.
- **hit@5 +rerank: 90% → 95%** (+5pp).
- **Median hybrid latency: 43 ms → 8 ms** — no HTTP RTT on the hot path; everything is in-process SQLite + ONNX.

### Migration notes

Existing v0.4.x users keep their Qdrant collection but it becomes orphaned — the embedding model changed (768-dim nomic → 384-dim bge-small) so vectors aren't cross-compatible. On first watcher startup after `metalmind stamp`, the auto-backfill re-embeds the entire vault into the new sqlite-vec store (~1 min per 1k notes on M1). The old Qdrant container can be removed at leisure (`docker rm metalmind-qdrant`); the `legacy` escape hatch keeps it working if you defer.

### Tests + CI

- Parametric protocol-contract tests for both `VectorStore` and `EmbeddingBackend` in one test file each. 23 tests covering both backends; runs hermetically (no daemons, no model downloads).
- Vault-rag suite: 16 → 44 tests. CLI suite: 280 → 281.

### Reverted from earlier development

- **Position-aware blend in `rerank_hits`** (briefly explored mid-v0.5.0 dev). With our two-list / no-expansion fusion, retrieval's #1 is wrong often enough that the 0.75 retrieval weight blocked the cross-encoder from recovering — every `hyb+rerank` row produced byte-identical ordering to plain `hyb`. Reverted before release; rerank is back to a pure cross-encoder resort.

---

## 0.4.0 — 2026-04-30

### Added — weighted hybrid retrieval

- **Top-rank bonus in RRF fusion.** A document that ranks #1 in any source list gets `+0.05` added once to its fused score; ranks #2–3 get `+0.02`. Bonus is keyed on the best (lowest) rank the doc achieved across all source lists, so it doesn't double-stack. Stops pure RRF from diluting hits that one retriever was confident about. Formula and constants from [qmd 2.1.0](https://github.com/tobi/qmd) (MIT) — same shape as their `reciprocalRankFusion` implementation.
- **Per-list weights in fusion.** Default keyword × 1.5, semantic × 1.0. With only two source lists and no query expansion, BM25 and the embedder often pick different #1s and produce identical RRF scores; ties broke on dict insertion order, often against the right answer. BM25 is more decisive at hit@1 for short factual queries (the dominant query shape in vault recall), so we let it lead. Tunable via `METALMIND_RRF_KEYWORD_WEIGHT` / `METALMIND_RRF_SEMANTIC_WEIGHT` for workloads that skew semantic.
- **Deeper fusion overfetch.** Each backend now produces 50 candidates before fusion (was 20 / `k`). Tunable via `METALMIND_RRF_OVERFETCH`. Larger candidate pool means cross-coverage is more likely — fewer single-list-only ties at the top.

### Result on the scaled recall bench (1,000 notes)

- **hit@1 hybrid: 50% → 65%** (+15pp). Three queries flipped from h@2 to h@1.
- **hit@5 hybrid: 85%** (stable).
- **hit@1 + rerank: 90%** (flat across every scale 12 → 1,000).
- **hit@5 + rerank: 90%** (was 85% in v0.3.0; +5pp).
- Latency unchanged: 43–48 ms median for hybrid across the curve.

### Added — agent template refresh

- **All 15 stamped subagents** (`a11y-reviewer`, `adversary` trio, `architect`, `api-contract-reviewer`, six engineering roles, three reviewers, `qa-engineer`, `security-reviewer`) bumped to `claude-opus-4-7[1m]` and granted `SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet` so they coordinate cleanly when spawned as teammates rather than as solo subagents. Templates also gain the explicit "every communication with the lead must go via SendMessage" rule that local development had been carrying out-of-band — pane-only prose was getting silently dropped.
- **`using-teams` skill** is now part of the stamp surface. It's the MUST-INVOKE-FIRST gate for `team-debug`, `team-feature`, `team-pr-review`, `team-multi-repo-audit` and any other team-coordination flow. Existing local skill copied verbatim into `cli/templates/claude/skills/using-teams/SKILL.md`. Fresh installs get it; existing users pick it up on next `metalmind stamp`.

### Added — recall hint in the CLAUDE.md block

- Stamped block now tells Claude to retry recall with 2–3 rephrasings if the first hit list is empty. Rephrase-then-union is the cheap-path equivalent of qmd-style query expansion: zero infra, zero additional latency on cold queries that succeed.

### Reverted

- **Position-aware blend in `rerank_hits`.** Briefly shipped during v0.4.0 development (modeled on qmd's pipeline) but reverted before release. With our two-list / no-expansion setup, retrieval's #1 is wrong often enough that the 0.75 retrieval weight blocked the cross-encoder from recovering — every `hyb+rerank` row produced byte-identical ordering to plain `hyb`. The position-blend works in qmd because their pipeline runs ~6 source lists (3 expanded queries × 2 backends), making rank-1 retrieval more reliable. Worth revisiting when query expansion lands.

### Bench guards

- **`bench/recall-v0/run.mjs` now checks `/rerank/status` before the per-question loop.** If `--rerank` was passed but the watcher venv lacks FlagEmbedding, prints a loud `rerank=DISABLED` banner and emits `n/a` in every rerank cell instead of a misleading number. Fixes the failure mode where the dev venv was rebuilt without `[rerank]` and the bench silently mirrored hybrid into the rr column.

---

## 0.3.0 — 2026-04-24

### Added — hybrid retrieval (default `tap copper` behavior)
- **SQLite FTS5 keyword index** at `~/.metalmind/fts-<collection>.db` alongside Qdrant. Indexer writes to both stores in lockstep; watcher's incremental path keeps them in sync. Porter tokenizer (stems English), chunk-level granularity matching Qdrant points. Ship criterion met: hit@5 at 1000 notes goes from 55% (semantic-only) to 85% (hybrid) to 90% (hybrid + rerank) on the scaled recall bench.
- **Reciprocal Rank Fusion** (`k=60`) merges semantic + keyword hit lists by rank, so BM25's unbounded scores and cosine's `[0,1]` range never need calibration.
- **New server modes**: `{mode: "hybrid" | "semantic-only" | "keyword-only"}` on `POST /search`. Default is `hybrid`. Legacy clients that omit `mode` automatically get hybrid — the old semantic-only path still available via flag for debugging or A/B.
- **FTS5 auto-backfill** on watcher startup. Detects the `Qdrant-populated / FTS5-empty` state that every v0.2.x upgrader will land in, rebuilds the keyword index once, and then resumes watching. Honor `VAULT_NO_FTS_BACKFILL=1` to defer on huge vaults. Without this, hybrid silently degraded to semantic-only until users touched files one at a time.
- **`VAULT_HTTP_PORT` env var** on the loopback HTTP recall server. Defaults to `17317` (unchanged). Lets multi-vault setups and the bench runner pick a free port.

### Fixed
- **`--rerank` was silently falling back to embedder-only ordering** for everyone who installed the `[rerank]` extra with `transformers ≥ 5.0`. FlagEmbedding 1.3's reranker calls `XLMRobertaTokenizer.prepare_for_model`, which was removed in transformers 5. Every `rerank=true` request logged `reranker.compute_score failed: AttributeError` at WARN level and returned the unreranked top-K — no visible error, no changed behavior at the CLI layer. Pinned `transformers<5` in the `rerank` extra (`packages/vault-rag/pyproject.toml`). Bumps `metalmind-vault-rag` to `0.1.1`.
- **`metalmind stamp` now upgrades the Python package** when the bundled version differs from the installed one. Previously, `installVaultRag` short-circuited on "already installed" regardless of version, so CLI upgrades silently failed to ship Python-side fixes (the rerank pin, VAULT_HTTP_PORT, FTS5 writes). Version-aware reinstall compares `pyproject.toml` version to `uv tool list` output and force-reinstalls on mismatch. Preserves the `[rerank]` extra across upgrades by probing `FlagEmbedding` importability in the tool venv and passing `extras: ['rerank']` through to the reinstall call.
- Discovered while running the scaled recall bench — rerank on vs off produced byte-identical hit@K numbers, which is what surfaced the silent-fallback bug.

### Added — doctor smoke checks
- **`metalmind-vault-rag-doctor --rerank`** smoke-tests a cross-encoder call with a known hit list and verifies `prev_score` is populated on the top hit. Catches the silent-fallback class of bugs — model missing, tokenizer version drift, OOM — that would otherwise look like "rerank is on" while returning unreranked results.
- **`metalmind-vault-rag-doctor --fts`** reports Qdrant point count vs FTS5 row count. Warns on empty-FTS5-while-Qdrant-populated (stuck in pre-upgrade state) and on significant drift (half-indexed vault, killed watcher, etc.). Runs by default in `--all`.

### Bench
- **`bench/recall-v0/` scaled mode.** Runner owns full lifecycle (`--scales 12,100,500,1000`): assembles isolated tmp vault + dedicated Qdrant collection + dedicated port, indexes, queries, teardown idempotent on Ctrl-C / crash / normal exit. Four modes measured side-by-side at every scale: `semantic-only`, `keyword-only` (FTS5), `hybrid` (RRF), `hybrid+rerank`, plus a pure-Node BM25 sanity column. Ship-criteria hit@5 at 1000 notes: semantic 55% / keyword-only 90% / hybrid 85% / hybrid+rerank 90%.
- **1000 seeded distractor notes** generated by `bench/recall-v0/scripts/gen-distractors.mjs` (`mulberry32`, 16 topic templates, same-domain Quillfly content disjoint from gold). Generator is deterministic (seed 42 by default); distractor markdown files themselves are gitignored — checking out the repo and running the generator produces byte-identical fixtures. No `./dataset-XXX.md` bloat in the tree.
- **Pure-Node BM25 scorer** at `bench/recall-v0/scripts/bm25.mjs`. Used as the sanity-check column; catches tokenizer or index drift in the server FTS5.

---

## 0.2.9 — 2026-04-24

### Added
- **`metalmind routine install eod` / `routine remove eod`** — launchd-backed end-of-day routine (macOS). At 17:30 Mon–Fri by default, runs `atium new --date next-workday --from <today>` then archives today's daily via `gold`. `--time HH:MM` overrides the schedule. Plist lives at `~/Library/LaunchAgents/com.metalmind.routine.eod.plist`; stdout/stderr go to `~/Library/Logs/metalmind-eod.{log,err}`. First routine shipped under the `metalmind routine` umbrella — the rest of the proposed routine family (morning stickies, etc.) lands when demand hits.

### Changed
- **`atium new` emits `- [ ]` checkbox bullets** instead of plain `- item`. Makes carry-forward explicit: unchecked boxes are "move me tomorrow"; `- [x]` or no bullet is "done, leave behind." Same for `atium add`.
- **`atium new --from` loosened to treat plain `- item` bullets as unchecked too.** Lets the routine carry items from pre-v0.2.9 daily notes without forcing users to retrofit every file. `- [x] done` is still correctly excluded.

---

## 0.2.8 — 2026-04-24

### Added
- **`atium new | add` (Scadrial) / `daily new | add` (classic)** — future-facing daily-note ops. `atium new --date <today|tomorrow|next-workday|YYYY-MM-DD>` creates the target note with frontmatter + empty `## Action Items`. `--from <prev-date>` carries over only unchecked `- [ ]` items from a prior note. `atium add "<item>" --date <date>` appends a bullet under `## Action Items`, creating the file + section if missing. Closes the gap that let agents reach for raw `Write` to create future-dated daily notes.
- **`gold <note>` (Scadrial)** — one-shot archive shortcut. Equivalent to `scribe archive <note>` but surfaces at top level so the "burning gold reveals past selves" metaphor lands. `scribe archive` / `note archive` remain the CRUD-path entry for consistency with the rest of scribe.
- **`flare banner | dialog | sticky` (Scadrial) / `notify banner | dialog | sticky` (classic)** — macOS desktop notifications. `flare banner <title> <text>` drops into Notification Center, `flare dialog <text>` opens a modal, `flare sticky <text>` creates a persistent Stickies.app note. Exits cleanly with an actionable error on Linux/Windows — these land when we do platform adapters.

### Changed
- **`scribe create --kind daily --slug X` now errors when `X ≠ today`**, pointing at `metalmind atium new --date X`. Before, the `--slug` was silently dropped and the note filed under today's date, producing a silent filename mismatch (the caller's motivating bug). Non-daily `scribe create` is unchanged.
- **`/save` skill rewritten.** The "write via Write tool" fallback in step 6 is gone — it taught agents to bypass metalmind the moment scribe couldn't express a target. Replaced with "stop and surface the gap." The skill now carries a scadrial/classic command table so agents know both names for every vault op. Plus an **end-of-day hook**: when the local hour is 16 or 17, Claude offers to push the session's pending items into the next-workday daily via `atium add --date next-workday` and fires a `flare banner` confirmation.
- **`writing-vault-notes` skill** gets the same scadrial/classic table and drops the "Write directly when scribe can't express it" escape hatch.
- **`scribe create --kind` help text** now lists all 8 valid kinds (`plan | learning | work | daily | moc | inbox | memory | personal`). The last two were callable since v0.2.7 but missing from `--help` output, which could steer agents away from them.

### Removed (breaking, pre-1.0)
- **`metalmind wipe`** classic alias dropped. Three paths to uninstall (`uninstall` + `burn aluminum` + `wipe`) was docs noise. `uninstall` (classic) and `burn aluminum` (Scadrial) both remain.

### Install wizard
- **Two new prompts, both opt-out.** `init` now asks "End-of-day hook in /save?" (default yes) and "Fire macOS notifications?" (default yes on macOS, skipped on Linux/Windows). Answers persist to `~/.metalmind/config.json` under `skills: { eodHook, notifications }`. `metalmind stamp` re-reads them on upgrade.
- **Flag parity with every prompt.** `--eod-hook` / `--no-eod-hook` and `--notifications` / `--no-notifications` let scripted installs skip the prompt without resorting to `--yes`.
- **Conditional skill rendering.** `/save` template now uses sentinel-wrapped optional blocks (`<!-- metalmind:eod:start -->`, `<!-- metalmind:notifications:start -->`). `copyClaudeTemplates` strips blocks whose flag is false, so users who decline never see the EOD prompt or the notify command in their skill. Nested notify-inside-EOD works — notify line is dropped from the EOD block independently.

### Docs
- **README + landing-page command table** now list `atium/daily`, `gold`, `flare/notify` alongside the existing metals, and reflect the `wipe` → `uninstall` classic-alias consolidation.

---

## 0.2.7 — 2026-04-22

### Added
- **`memory:` and `personal:` kind-prefixes.** Both folders existed in the vault (`Memory/`, `Personal/`) and the `writing-vault-notes` skill already listed them, but `scribe` rejected them with `unknown kind`. Another Claude session ran into this live. `KIND_DIRS` now covers all eight intent folders; `resolveNotePath` test covers the new prefixes.

### Changed
- **`writing-vault-notes` skill hardened.** Now opens with "Every vault operation goes through `metalmind scribe <verb>`" so agents don't waste a turn on `metalmind show`. Adds an explicit table of all valid `kind:` prefixes so an agent can see the full set without trial-and-error.

---

## 0.2.6 — 2026-04-22

### Fixed
- **`scribe patch` regex dropped parenthesized headings.** The metacharacter-escape character class `/[.*+?^${}()|[\\]\\\\]/g` had one backslash too many — `\\]` inside the regex literal parsed as literal `\` followed by `]`, **closing the character class early**. Net effect: every section heading with `(`, `)`, `.`, or any other metacharacter failed silently with "section not found", forcing a fallback to raw `Write`/`Edit` and eroding the "scribe is the only writer" contract. Fix at `cli/src/scribe/scribe.ts:240` drops one `\`. Regression test in `scribe.test.ts` covers a heading with both parens and a dot.

---

## 0.2.5 — 2026-04-22

### Added
- **`writing-vault-notes` skill**, auto-installed to `~/.claude/skills/` via `metalmind stamp`. Clean-room Obsidian Flavored Markdown reference (wikilinks, embeds, callouts, block refs, tasks, highlights) plus metalmind-specific conventions: `scribe` stamps frontmatter so bodies stay frontmatter-free, `[[kind:slug]]` wikilink shortcuts, folder-by-intent over per-project subdirs. Loads on demand — only the name + description enter the standing session context (~60 tokens); full body loads only when the skill triggers on a note-writing task. Existing users need to re-run `metalmind stamp` to pick it up.

### Changed
- **`copyClaudeTemplates` now copies skill bundles.** New `copySkillBundles` helper recursively mirrors every directory under `cli/templates/claude/skills/` into `~/.claude/skills/`, so future skills drop in without touching the install pipeline.

---

## 0.2.4 — 2026-04-21

### Fixed
- **Rerank warmup folded into bootstrap.** 0.2.3 successfully installed the `[rerank]` extra and restarted the watcher, but the user's first real `--rerank` query then timed out at the CLI's 6 s HTTP cap while the fresh watcher process downloaded the ~500 MB model — and the recall silently fell back to stdio (embedder ordering, not reranked). Bootstrap now issues a throwaway rerank warmup request against `/search` after the watcher restarts, absorbing the model download into the already-explicit setup phase. Separately: HTTP timeout for rerank calls lifted to 90 s so an unwarmed first call has headroom instead of racing the stdio fallback.

---

## 0.2.3 — 2026-04-21

### Fixed
- **`uv tool install` syntax for the rerank extra.** `--from <path> metalmind-vault-rag[rerank]` is not valid uv syntax — uv rejects "path + extras-on-named-package" as conflicting. Switched to the positional `<path>[rerank]` form when extras are requested; the no-extras path (every release ≤ v0.2.0 used this) stays on `--from <path> metalmind-vault-rag`. Caught live on first bootstrap run.

---

## 0.2.2 — 2026-04-21

### Fixed
- **Rerank bootstrap now handles stale Python packages.** Upgrade path between 0.1.x / 0.2.0 / 0.2.1 Python-side watchers: the `/rerank/status` endpoint doesn't exist in older packages, so a 404 response was misread as "watcher unreachable" and the bootstrap silently skipped. 0.2.2 distinguishes 404 (Python package predates the endpoint — run the `[rerank]` reinstall, which also upgrades the package) from connection-refused (no watcher running — stay hands-off).

---

## 0.2.1 — 2026-04-21

UX fix on top of 0.2.0: stop asking users to run a weird-looking `uv tool install 'metalmind-vault-rag[rerank]'` command by hand. First `metalmind tap copper --rerank` now bootstraps itself.

### Changed
- **Reranker bootstrap is now auto-on-first-use.** When you run `tap copper --rerank` (classic alias: `recall --rerank`), the CLI probes a new `/rerank/status` endpoint on the watcher. If `FlagEmbedding` is missing, the CLI runs the `[rerank]` extra install itself, restarts the watcher (launchctl on macOS, systemctl on Linux), polls until the new process is ready, then proceeds with the rerank call. One-time ~1.2 GB download on first use; zero-friction from then on. No more copy-paste-a-uv-command.
- `installVaultRag` (internal) gains an `extras` option; watcher restart extracted into `watcher-restart.ts` (shared between bootstrap + future upgrade paths).

---

## 0.2.0 — 2026-04-21

Minor-rev bump: new recall tier, new optional dep group, Linux-real coverage, and a landing-page positioning split. Nothing removed; everything opt-in.

### Added
- **Reranker tier (`tap copper --rerank` (classic alias: `recall --rerank`)).** Cross-encoder (`BAAI/bge-reranker-v2-m3`) overfetches 4× from Qdrant and re-scores before returning top-k. Closes the hit@1=70% → hit@5=90% gap the recall-v0 bench exposed. Opt-in; first call downloads ~500 MB. Graceful fallback to embedder ordering if the dep is absent. Themed first-load message honors `METALMIND_FLAVOR` ("lighting the duralumin…" when `scadrial`). *(0.2.0 required a manual `uv tool install` to enable the extra — 0.2.1 bootstraps automatically on first use.)*
- **`bench/recall-v0/ --rerank`.** Same runner, `--rerank` flag or `METALMIND_BENCH_RERANK=1` flips it into rerank mode. Rerank runs bump the timeout to 180 s so the first-call model warmup doesn't abort. Meta block records which mode was used.
- **Linux CI matrix.** New `.github/workflows/ci.yml` runs tests on `macos-latest` and `ubuntu-latest` for every PR and push-to-main. Teardown tests now pass `platformOverride: 'darwin'` so the same expectations hold on both runners. `publish.yml` stays pinned to macOS — release pipeline is intentionally not gated on Linux CI.
- **`/forge` site page.** Dedicated pitch for the cross-repo code-graph story — what a forge is, the three confidence tiers (`INFERRED_NAME` / `INFERRED_ROUTE` / `INFERRED_URL_LITERAL`), three-tier route extraction explained, its own commands table, anti-persona, under-the-hood diagram. Closes item #8 from the 2026-04-20 product analysis.

### Fixed
- **Forge cache: spec-mtime invalidation.** Route + merged-graph caches were fingerprinted only against each repo's `graphify-out/graph.json` mtime. Editing an OpenAPI spec via `forge capture-spec` did not bust either cache — users silently got stale route edges until the graph was bumped. Per-repo fingerprint is now `max(graphMtime, shelfSpecMtime)`. `METALMIND_SHELF_DIR` env var added for test isolation.

### Changed
- **Homepage slimmed to memory.** The four forge-related feature cards (sight-across-repos, iron/steel navigation+rename, zinc team-debug) collapsed into one dashed "And: cross-repo code graph" sibling card linking to `/forge`. Visitors who want memory find it in the hero; visitors who want code-graph find it one click away. No features removed — only repositioned.
- **`teardown()` internal signature.** `claudeDir` and `settingsPath` now required (no silent fallback to real `~/.claude`). Private API — callers are the `uninstall` command and tests; both updated.

---

## 0.1.11 — 2026-04-21

### Fixed
- **Vanishing stamped block bug.** `teardown()` defaulted `claudeDir` to the real `~/.claude` when tests forgot to pass one, causing every `pnpm test` run to strip the metalmind managed block from the user's `~/.claude/CLAUDE.md` and delete the session-start hook. `claudeDir` and `settingsPath` are now required options — any future test that omits them fails at the type level, not at the data-loss level.

### Added
- **`bench/mcp-tax-v0/`** — reproducible first-turn token-tax bench vs mem0, metalmind's stdio MCP fallback, and Claude Code native `/memory`. `pnpm bench:mcp-tax` prints a copy-paste markdown table; runs via Anthropic `count_tokens` when `ANTHROPIC_API_KEY` is set, falls back to char/4 approximation otherwise. Headline: **~2.5× lower** than mem0 as shipped, **~8.4× lower** on the apples-to-apples MCP comparison.
- **`CHANGELOG.md`** at repo root + matching `/releases` page on the site.

### Changed
- **README + site** surface forge (three-tier route extraction), steel (rename), zinc (team-debug), and scribe (vault CRUD) as first-class features alongside copper, per the 2026-04-20 product analysis. New anti-persona section explicitly lists who should *not* install metalmind. Bench copy sharpened to the 2.5× / 8.4× framing.

---

## 0.1.10 — 2026-04-21

### Fixed
- **Warm-path orphan-cache prune.** `pruneOrphanRouteCaches()` was only wired into `buildMergedGraph` — `loadOrBuildMerged` short-circuits on a warm merged cache, so orphan entries at `~/.metalmind/forge/routes/*.json` persisted across runs even after the source repo was deleted. Moved the prune call up into `loadOrBuildMerged` so it fires on every invocation.

---

## 0.1.9 — 2026-04-21

### Added
- **Tier 3 URL-literal route extraction** (opt-in via `--include-literals`). Scans ~15 text extensions for path-shaped string literals as a last-resort fallback when OpenAPI specs and Java caller parsers miss. Every edge carries `INFERRED_URL_LITERAL` provenance so the caller can trust-grade. Noise filter drops static asset extensions (`.png/.jpg/.css/.js/.html/.md/.yaml/.log/.tmp/.bak/.lock/.txt/.xml/.pdf`).
- **CI Node 24 opt-in** via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` in `.github/workflows/publish.yml`. Keeps the publish pipeline unblocked through 2026-09-16.

---

## 0.1.8 — 2026-04-21

### Fixed
- **Orphan route-cache pruning.** First pass: `pruneOrphanRouteCaches()` now runs at the top of `buildMergedGraph`, deleting cache entries whose source repo is missing. One-time cleanup of 33 stale entries from the local shelf.

---

## 0.1.7 — 2026-04-21

### Added
- **`metalmind release-check` (alias: itself).** Pre-tag preflight — working tree clean, on main branch, `metalmind --version` matches `cli/package.json`, tests pass, build passes, `metalmind doctor` clean, stamped block present in `~/.claude/CLAUDE.md`. Skips tests/build with `--skip-tests --skip-build` for speed during debugging.
- **`metalmind scribe rename` + backlink rewriting.** Moves a vault note to a new kind/slug and rewrites every `[[wikilink]]` reference in the vault (forms: `[[slug]]`, `[[slug|alias]]`, `[[slug#heading]]`, `[[dir/slug]]`).

---

## 0.1.6 — 2026-04-21

### Added
- **Forge Tier 1 — language-agnostic OpenAPI route extraction.** Reads specs from a metalmind-managed shelf at `~/.metalmind/specs/<repo>.{yaml,json}` — never from inside the target repo. Satisfies the "single-dev tool, zero repo pollution" constraint. `metalmind forge capture-spec <repo> <url-or-file>` seeds the shelf; `forge spec-list` / `forge spec-remove` manage it.
- **Forge Tier 2 — Java caller extraction.** Regex-based parser for `RestTemplate` (getForObject/postForEntity/exchange), `WebClient` fluent (`.get().uri()`, `.method(HttpMethod.X).uri()`), and `Feign` clients (`@GetMapping` inside `@FeignClient` interfaces). Cross-repo `INFERRED_ROUTE` edges now link Java callers to handlers in any target language.
- **`metalmind scribe` (alias: `note`) — vault note CRUD.** Full flow: `create · update · patch · delete · archive · list · show`. Stamps frontmatter, picks the right folder from `kind` (plan/learning/work/daily/moc/inbox → Plans/Learnings/Work/Daily/Work-MOCs/Inbox), auto-links the project MOC, supports `--dry-run` on every verb, accepts `kind:slug` shortcuts (`learning:foo`, `plan:2026-04-21-bar`). Soft-delete by default (notes move to `<vault>/.trash/`).

---

## 0.1.5 — 2026-04-21

### Fixed
- **graphify subcommand rename.** graphify removed the `analyze` subcommand; metalmind was still calling it. Switched to `graphify update` in all call sites.

---

## 0.1.4 — 2026-04-20

### Changed
- **Flat `~/Knowledge/Plans/` layout.** Plans are no longer nested by project subdirectory — all plan notes live flat in `Plans/`, grouped by `project:` frontmatter and a per-project MOC in `Work/MOCs/<project>.md`. Reduces folder fatigue and makes cross-project plan search work out of the box.
- **MOC template scaffold.** `metalmind init` now seeds a starter Map-of-Content template at `Work/MOCs/.template.md`.

---

## 0.1.3 — 2026-04-20

### Added
- **OIDC trusted-publisher release pipeline.** `.github/workflows/publish.yml` publishes to npm via OIDC + sigstore provenance on every `v*.*.*` tag push. No `NPM_TOKEN` secret required.

---

## 0.1.1 — 2026-04-20

### Fixed
- **`metalmind --version`** now reads from `package.json` (was a hard-coded string). Prevents version-drift between `npm view metalmind version` and what the CLI reports locally.

### Added
- **`bench/recall-v0/`** — reproducible recall-quality bench against a 12-note fake vault. Current measured numbers: hit@5 = 90%, hit@3 = 85%, hit@1 = 70%; latency median 45 ms / p95 87 ms. Baked into README and site.

---

## 0.1.0 — 2026-04-20

Initial public release.

- One themed CLI (Scadrial verbs + Classic aliases). `metalmind init` drives the whole install; `metalmind uninstall` reverses it — never touches your notes.
- Loopback-HTTP recall at `127.0.0.1:17317` as the default transport; stdio-MCP as always-available fallback.
- SessionStart hook + stamped `CLAUDE.md` block teach Claude Code when to recall, without injecting MCP tool schemas.
- Per-repo code graphs via graphify; cross-repo merge in the metalmind *forge* with `INFERRED_NAME` edges.
- Serena LSP backs `burn iron` (symbol navigation) and `burn steel` (coordinated rename).
- `burn zinc` dispatches to the `/team-debug` skill with the code graph pre-primed.
