# Changelog

All notable changes to metalmind are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

The single source of truth for a release is the git tag and the published [npm package](https://www.npmjs.com/package/metalmind). This file summarizes the **why** for each release; the commit log has the full **what**.

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
