# metalmind

[![npm version](https://img.shields.io/npm/v/metalmind.svg?color=%23d4a14a&label=npm&cacheSeconds=300)](https://www.npmjs.com/package/metalmind)
[![license](https://img.shields.io/npm/l/metalmind.svg?color=%23d4a14a&cacheSeconds=300)](LICENSE)

**The missing standard library for your coding agent - memory, vault sync, code intelligence, daily workflow, deliberation. Local, integrated, zero standing MCP-schema tax. Works with Claude Code, Codex CLI, and Cursor. Your agent never meets you cold again.**

Every `claude` invocation is a first meeting. Yesterday's architectural call, the reason you rejected that library, the 40-minute debug you just finished - gone by tomorrow. **Memory** is metalmind's headline. **Vault sync** (guarded git push), **code intelligence** (cross-repo graphs, symbol nav, coordinated rename), **daily workflow** (action-item carry-forward, EOD routines), and **deliberation** (a 7-persona synod for hard calls) ship with it - every module integrated through one vault, one CLI, one stamped `CLAUDE.md` rule.

Website: **[metalmind.mzyx.dev](https://metalmind.mzyx.dev)**

## What's in the standard library

Seven modules. Each closes a gap Claude Code itself doesn't fill. All share state through your vault. None register an MCP tool schema.

| Module | Surface | What it owns |
|---|---|---|
| **Memory** | `tap copper` / `store copper` / `scribe` | Recall + save + vault CRUD. The headline; the rest of the library compounds back into it. |
| **Code intelligence** | `forge` / `burn iron\|steel` | Cross-repo graph (HTTP-route and symbol-name edges with provenance), coordinated rename through Serena's LSP. Within a single repo, use [codegraph](https://github.com/colbymchenry/codegraph). |
| **Vault sync** | `duralumin` / `sync` | Commit and push the vault in one command, refusing change sets that look like note loss. |
| **Daily workflow** | `atium` / `gold` / `routine install eod` | Daily-note action items with `--from` carry-forward, one-shot archive, launchd-backed Mon-Fri EOD carry-and-archive. |
| **Deliberation** | `synod` | 7-persona deliberative council for the questions that affect the next 6 months - spawned as parallel subagents, synthesised into a structured verdict. |
| **Desktop integration** | `flare` | macOS banner / dialog / sticky notifications wired into the EOD routine and `/save`. |
| **Health** | `pulse` / `doctor --recall-audit` | Install verification + the first memory tool that tells you when recall is failing you. |

**The four rules every module clears** - name the moat in negative:

1. Zero standing MCP-schema tax in Claude Code.
2. Reversible to zero - `metalmind uninstall` never touches your notes.
3. No accounts, no cloud, no third-party services.
4. Closes a gap Claude Code itself doesn't fill - no duplication of host primitives.

This bar refuses, by construction, anything that would make metalmind a chat assistant, a cloud-sync product, or a hosted memory service.

---

## What it's actually for

metalmind pays off when your knowledge lives across **more than one repo**. A single-repo user gets a lot from Claude Code's native `/memory` - text in `CLAUDE.md`, free, no moving parts. A multi-repo engineer - same vault across every project, decisions that outlive any single codebase, code graphs that cross service boundaries - is who metalmind is built for.

- **One vault, every project.** `project:` frontmatter plus a MOC per project. A decision written in repo A surfaces when you `tap copper` in repo B if it's topically relevant. Native `CLAUDE.md` is scoped per-project; learnings don't cross-pollinate.
- **Cross-repo code graph via forge.** `metalmind forge` builds one graph across every repo in a group. HTTP-route edges connect a caller in one service to a handler in another - Claude native has no concept of "the other service's code." More on the [forge page](https://metalmind.mzyx.dev/forge).
- **Knowledge that compounds.** Each new project starts with every learning you've documented elsewhere. `Learnings/` is intentionally flat - "CLIs should never paste weird package-manager invocations" applies to every repo. With native memory you'd copy-paste the insight into every project's `CLAUDE.md` separately.
- **Decisions that outlive the codebase.** Repos get archived, rewritten, replaced. The vault doesn't - plain markdown in your own directory, searchable forever.

**Where native `/memory` still wins:** solo repo, under ~50 notes of context, no historical lookback needed. Below that break-even, it's simpler and free. metalmind earns its install cost when you've got more to remember than a single `CLAUDE.md` can cheaply hold.

### The three memory types, mapped

Agent-memory research converges on a three-way taxonomy, and the vault's folders already implement it:

| Memory type | What it holds | Where it lives |
|---|---|---|
| **Episodic** - what happened | Daily logs, session action items, time-bound state | `Daily/`, `Inbox/` |
| **Semantic** - what is true | Decisions, architecture notes, durable learnings, project state | `Work/`, `Learnings/`, `Plans/`, `Memory/` |
| **Procedural** - how to act | Rules, skills, command references stamped into every session | `~/.claude/rules/`, skills, the stamped `CLAUDE.md` block |

Temporal supersedes keeps the semantic layer honest (old truths re-rank below their successors instead of being deleted), code refs keep it checkable against the repos it describes, and `ingest auto-memory` feeds the episodic exhaust of native memory into the semantic store.

---

## Module detail

### Memory

- **Save once.** `metalmind store copper "<insight>"` (alias: `save`) deposits a decision into your local vault. metalmind proposes the path, wikilinks, and frontmatter; you approve; it writes.

- **Recall without the MCP token tax.** `metalmind tap copper "<query>"` (alias: `recall`) is a Bash call, not an MCP tool. Zero schema bloat per session - most memory tools silently inject a handful of tool schemas - often heavily over-specified - into every host session before you've typed a prompt (measured: [`bench/mcp-tax-v0/`](bench/mcp-tax-v0/)). We stamp the command into your `CLAUDE.md` (and `~/.codex/AGENTS.md` when Codex is installed) so the model reaches for it naturally. `--deep` escalates with backlink-walks; `--expand` returns hits plus the surrounding graph; `--list-recent N` browses the N most-recently-modified notes without a query. A co-hosted loopback HTTP server (`127.0.0.1:17317`) inside the watcher process handles recall calls sub-100ms, with stdio MCP as the always-available fallback for hosts that need it. Browser-origin requests to that port are always rejected, so a web page cannot poke it. The watcher also writes an auth token to `~/.metalmind/recall-token` (mode 0600) and the CLI sends it automatically, but the token is **not enforced by default**: on a single-user machine it would buy nothing, since anything running as you can read the vault directory anyway. Set `METALMIND_RECALL_REQUIRE_TOKEN=1` in the watcher env on a **shared machine**, where it stops other UNIX accounts from querying your vault. Scripting against the port under enforcement? Send the file's contents as `X-Metalmind-Token`.
  <br><sub>**Measured** on the 12-note fake vault in [`bench/recall-v0/`](bench/recall-v0/): **hit@5 = 100%**, **hit@3 = 95%**, **hit@1 = 95%**, latency **median 7 ms / p95 15 ms**. Hit payloads are billed like any other bash output; the MCP tax we avoid is the standing tool-schema cost, not the result tokens.</sub>

- **Session-start awareness without nagging.** metalmind installs a Claude Code SessionStart hook plus a top-of-file block in `~/.claude/CLAUDE.md` with explicit WHEN→DO triggers, so every new Claude session discovers the vault on its own - no "did you check memory?" prompting. Re-stamp anytime with `metalmind burn brass` (alias: `stamp`) after an upgrade.

- **Vault writes without drift.** `metalmind scribe <create|update|patch|supersede|delete|archive|list|show|rename>` (alias: `note`) is the CRUD interface agents use *instead of* raw `Write`. It stamps frontmatter, picks the right folder (`Plans/ Learnings/ Work/ Work/MOCs/ Daily/ Inbox/ Memory/ Personal/ Archive/`), auto-links the project MOC, and on `rename` rewrites `[[wikilinks]]` across the vault. `supersede <old> <new>` marks a decision replaced by its successor - recall downweights the old note and every hit from it carries `superseded_by` so agents land on current truth. Notes can also carry `code: ["repo#symbol"]` refs (stamped via `--code`); `tap copper --verify-code` and `doctor` flag refs whose code no longer exists in the forge-registered repos, so a note's claims stay checkable against the code they describe. `metalmind ingest auto-memory` imports Claude Code's native auto-memory topic files as `Memory/` notes - idempotent, hash-guarded, and conflict-safe - so native memory feeds the vault instead of competing with it. Body on stdin; every mutating verb supports `--dry-run`. Daily notes for non-today dates require `--date <YYYY-MM-DD>` to acknowledge the target explicitly.

### Code intelligence

- **Sight across repos, not just one.** `metalmind forge` builds one graph over every repo in a group, reading your source directly - no indexing step and no external tool. HTTP-route-match edges connect caller → handler *across services* in three tiers: OpenAPI specs on the metalmind shelf (never inside your repos), Java RestTemplate/WebClient/Feign callers, and URL literals as an opt-in fallback. Symbol-name edges connect the same type or function where it surfaces in two different repos. Every inferred edge carries `INFERRED_NAME` / `INFERRED_ROUTE` / `INFERRED_URL_LITERAL` provenance so Claude can trust-grade what it reads.

- **Find where a symbol is declared.** `metalmind burn iron <symbol>` (alias: `symbol`) searches the current repo, or every repo in a forge with `--forge`, and names the file and line for each declaration. It runs on metalmind's own extractor - no index to build, no external tool. Substring by default, `--exact` for the precise name, `--json` for machines.

- **For callers and call paths, use codegraph.** [codegraph](https://github.com/colbymchenry/codegraph) is a local, MIT-licensed code-graph tool with its own MCP server, and it does the parser-backed half - callers, callees, blast radius, affected tests - better than metalmind ever did. metalmind deliberately does not wrap it: install it alongside. Retired in v0.15.0: `burn bronze`, `burn pewter` and their `graph` / `reindex` aliases.

- **Coordinated rename.** `metalmind burn steel <old> <new>` (alias: `rename`) drives a rename through Serena's LSP backend.

- **Team-debug, dispatched.** `metalmind burn zinc "<bug>"` (alias: `debug`) hands a bug to the `/team-debug` skill.

### Daily workflow

- **Action-item carry-forward.** `metalmind atium new --date <today|tomorrow|next-workday|YYYY-MM-DD>` (alias: `daily new`) seeds a future daily note. `--from <prev-date>` carries unchecked items forward. `metalmind atium add "<item>" --date <date>` (alias: `daily add`) pushes individual items in.

- **Archive shortcut.** `metalmind gold <kind:slug>` (alias: `scribe archive`) moves a note to `Archive/` and stamps `status: archived` in one verb.

- **EOD launchd routine.** `metalmind routine install eod` registers a Mon-Fri 17:30 launchd agent that carries unchecked items to the next workday and archives today's daily. `routine remove eod` reverses it.

### Deliberation

- **Convene the synod.** `metalmind synod "<question>"` spawns a 7-persona deliberative council in parallel subagents (Adversary, Strategist, Scientist, Visionary, Engineer, Philosopher, Humanist - or Kelsier's crew under Scadrial flavor) and synthesises a structured verdict (position, confidence %, 3 critical risks, 5 next steps, minority report). For decisions that affect the next 6 months, not the next 60 minutes.

### Desktop integration (macOS)

- **Banner / dialog / sticky.** `metalmind flare banner|dialog|sticky <title> <message>` (alias: `notify`) - desktop notifications wired into the EOD routine and into the `/save` skill.

### Health

- **`metalmind pulse` (alias: `doctor`).** End-to-end install check - watcher, recall HTTP fast-path, stamped sentinels. Add `--deep` for live-service probes; add `--recall-audit` to replay the opt-in recall log and surface zero-hit / weak-hit queries as `/save` candidates.

- **Reversible to zero.** `metalmind uninstall` (alias: `burn aluminum`) stops the watcher, restores prior settings, clears shell aliases, and strips every sentinel-bounded block we wrote. **It never touches your notes.**

## Why it isn't an MCP server

Most memory tools register themselves as MCP servers. That design injects a handful of tool schemas (`search_memory`, `recall`, `store`, …) into **every** Claude session before you prompt anything. Those schemas eat context tokens you could be using for the actual task.

metalmind takes the opposite bet: the recall surface is a CLI, Claude learns the command once from your stamped `CLAUDE.md`, and every session starts with a clean context. The watcher, indexer, and embedding stack still live locally - they just don't live in Claude's tool registry.

**Measured** in [`bench/mcp-tax-v0/`](bench/mcp-tax-v0/) - first-turn token tax on a cold session:

| System | Transport | Tools | First-turn tokens |
|---|---|---:|---:|
| **metalmind** (default) | loopback HTTP | 0 | ~519 *(one-time CLAUDE.md instruction block)* |
| Claude Code native `/memory` | CLAUDE.md text | 0 | ~1 |
| metalmind (stdio MCP fallback) | MCP stdio | 3 | ~157 |
| mem0 (`pinkpixel-dev/mem0-mcp`) | MCP stdio | 3 | ~1,319 |

**~2.5× lower than mem0 as shipped** (loopback-HTTP vs stdio MCP), **~8.4× lower on the apples-to-apples MCP comparison** (metalmind's stdio fallback vs mem0 - same transport, different schema discipline). The ~519 tokens metalmind spends up front are prose in `~/.claude/CLAUDE.md` that teaches Claude *when* to recall - work that mem0's schema-tax doesn't do. Approximation via `chars / 4`; re-run with `ANTHROPIC_API_KEY=... pnpm bench:mcp-tax` for exact counts. `bench/mcp-tax-v0/README.md` details methodology and limits.

## Recall quality at scale

Token cost is only half the story - recall has to actually find your note. `v0.5.0` runs the entire retrieval stack in-process (sqlite-vec for vectors, fastembed for embeddings, FTS5 for keyword) - no Docker, no daemon. Hybrid retrieval fuses semantic + keyword via RRF with a top-rank bonus and per-list weights. Measured in [`bench/recall-v0/`](bench/recall-v0/) on 12 hand-authored gold notes plus up to 988 seeded same-domain distractors, 20 paraphrase-ish queries:

| Vault size | sem-only hit@5 | **hybrid hit@1** | **hybrid hit@5** | **+rerank hit@1** | **+rerank hit@5** |
|---:|---:|---:|---:|---:|---:|
| 12 notes | 100% | **95%** | **100%** | **95%** | 100% |
| 100 notes | 95% | **85%** | **90%** | **85%** | 95% |
| 500 notes | 80% | **85%** | **85%** | **85%** | 90% |
| 1,000 notes | 80% | **85%** | **85%** | **85%** | 90% |

Remeasured for v0.23.0, which cut reranking from 7.5s to 1.3s per query. This
corpus is the least demanding of the three benchmarks here: its distractors are
generated to differ from the gold note, so nothing ever asks the ranker to
choose between two notes that both look right. Reranking buys nothing at hit@1
on it at any scale, while gaining 7 points on
[`bench/adversarial-v0/`](bench/adversarial-v0/) and 6 on LongMemEval, both of
which do ask. 20 questions per scale, so one question is 5 points.

The v0.21.0 remeasurement note still applies: an earlier version of this table
read up to 5 points higher at 500 and 1,000 notes and could not be reproduced,
because the corpus was generated rather than committed and a repo-wide
formatting sweep had edited the generator.

**At 50,000 notes** ([`bench/recall-at-scale/`](bench/recall-at-scale/), HN comments, 12-core Linux):

| Vault size | hit@1 | hit@3 | hit@5 | misses | index | p50 | p95 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 100% | 100% | 100% | 0/20 | 35 s | 26 ms | 37 ms |
| 10,000 | 100% | 100% | 100% | 0/20 | 449 s | 112 ms | 160 ms |
| 50,000 | **95%** | **100%** | **100%** | 0/20 | 68 min | 390 ms | 617 ms |

Every question finds its answer inside the top 3 at every scale, and nothing misses at k=5. 50× the corpus costs ~15× the query latency - still sub-620 ms p95, with no server and no daemon. This was the gate on deleting the Qdrant + Ollama backend; it held, and that backend is gone as of v0.16.0.

Hybrid is the default. Fusion weights adapt per query: exact-match tokens (UUIDs, numeric IDs, ticket IDs like `RED-991`, hostnames, emails) raise the keyword-leg weight, since BM25 beats embeddings on literal identifiers (`METALMIND_RRF_ADAPTIVE=0` restores fixed weights). Fused scores are folder-weighted - `Archive/` 0.4x, `Inbox/` 0.7x - so stale notes re-rank below in-flight work. `--rerank` (opt-in) adds a cross-encoder rescore at ~1.3 s per query. `--semantic-only` and `--keyword-only` flags let you A/B any query. The `BAAI/bge-small-en-v1.5` embedding model is a 30 MB ONNX wheel cached at `~/.metalmind/cache/fastembed/`.

**Side-by-side with [qmd 2.1.0](https://github.com/tobi/qmd) on the same fixture:**

| Vault size | metalmind hit@1<br>(+rerank) | qmd hit@1 | metalmind hit@5<br>(+rerank) | qmd hit@5 |
|---:|---:|---:|---:|---:|
| 12 notes | **90%** | 85% | 95% | **100%** |
| 100 notes | **95%** | 80% | 95% | 95% |
| 500 notes | **90%** | 85% | 90% | **95%** |
| 1,000 notes | **90%** | 85% | 90% | 90% |

qmd ships the same shape (BM25 + vector + RRF + rerank) with different defaults - `qwen3-reranker`, a fine-tuned 1.7B query expansion model, GGUF stack, ~2 GB on first run. qmd wins hit@5 at the smallest and one middle scale (more recall headroom from query expansion); metalmind wins hit@1 across every scale (better top-of-list precision after the v0.4.0 weighted-RRF fix). Reproduce with `node bench/recall-v0/run.mjs --scales 12,100,500,1000 --rerank` from the repo root.

## How metalmind compares

Numbers above are recall on a fixed corpus. The shape comparison - what each tool stores, how the agent reaches it, where the data lives - matters just as much when picking one:

| Dimension | metalmind | native `/memory` | [qmd](https://github.com/tobi/qmd) | [mem0](https://mem0.ai) | [Letta](https://www.letta.com) | [Mastra](https://mastra.ai) |
|---|---|---|---|---|---|---|
| Memory primitive | Markdown chunks (file-mapped) | Markdown text in `CLAUDE.md` (per-project) | Markdown chunks (file-mapped) | LLM-extracted facts | Managed memory blocks | Threads + working memory |
| Source preservation | Yes - notes intact | Yes - text intact | Yes - files intact | No - facts replace docs | Partial - buffer + summaries | Yes - message history |
| Recall determinism | Deterministic | N/A - text always-loaded | Deterministic | LLM extracts on every write | LLM mediates updates | Deterministic + LLM summary |
| How agents call it | Bash → loopback HTTP | Always loaded into context | Bash CLI (MCP optional) | MCP server or SDK | HTTP server (own runtime) | TS framework API |
| Standing tokens in Claude Code | ~519 (prose in `CLAUDE.md`) | Full `CLAUDE.md` per session, per repo | ~0 (CLI; MCP opt-in) | ~1,319 (3 MCP schemas) | n/a - different host model | n/a - different host model |
| Cross-repo | Yes - one vault, every project | No - scoped per repo | Yes - one config, every project | Yes - cloud-mediated | Yes - Letta server | Yes - store-dependent |
| Where state lives | Local vault + sqlite-vec | Local - `CLAUDE.md` in repo | Local files + sqlite | Cloud or self-hosted vector DB | Cloud or self-hosted Letta server | Pluggable (pgvector / cloud) |
| Walk-away cost | Zero - vault is plain markdown | Zero - files stay readable | Zero - files stay readable | Export needed; facts ≠ docs | Export needed; data lives in Letta | Depends on chosen store |

**Native `/memory`** (text in `CLAUDE.md`) is the zero-install baseline every Claude Code user already has. metalmind earns its install cost once knowledge crosses repo boundaries - the row that flips is *Cross-repo*. **Letta and Mastra are agent frameworks with built-in memory** - different category from metalmind / qmd / mem0 (memory *tools* you bolt onto an existing host). Listed because they show up in "memory for AI" searches; "different host model" rows are honest about the apples-vs-oranges shape, not a metalmind win.

**Pick metalmind** when your knowledge crosses repo boundaries and you want Claude Code to read it verbatim with zero standing tax. Pick **native `/memory`** if everything you care about lives in one repo. Pick **mem0** for fact extraction from conversations. Pick **Letta** or **Mastra** when you're building agents inside their framework. Pick **qmd** if you want the same shape on a non-Claude host.

## Will this still be around?

Fair question for any solo-maintainer tool. The sustainability story:

- **Your notes outlive metalmind.** The vault is plain markdown in your own `~/Knowledge/` directory. If this project goes unmaintained tomorrow, you keep everything - Obsidian still opens the files, `grep` still searches them, `git` still versions them. metalmind is the layer that makes Claude use them well, not the layer that holds them hostage.
- **No cloud, no accounts, no phone-home.** Embeddings, indexing, recall, code graphs - all local. There is no metalmind backend to shut down, no API quota to throttle, no subscription to lapse. The only network call is the one you were already making to Claude.
- **Reversible in one command.** `metalmind uninstall` stops the watcher, strips the sentinel-bounded blocks from your `CLAUDE.md` files (user content outside markers is preserved), and clears shell aliases. Your vault is never touched. Try it - then reinstall if you like it.
- **MIT licensed.** Fork it, vendor it, swap the embedding backend. The architecture decisions are documented (`docs/`, `bench/`, `CHANGELOG.md`) specifically so a contributor - or a future-you - can keep it running.
- **The plan is public.** [`docs/roadmap.md`](docs/roadmap.md) lists what's being worked on for the next 90 days, what's queued behind it, and what has been ruled out. 68 releases since 2026-04-20, each with its reasoning in the changelog. Not a promise - a history you can check, and a plan you can hold it to.

## Install

**Via npm (recommended):**

```bash
npm install -g metalmind
metalmind init
```

Published at [npmjs.com/package/metalmind](https://www.npmjs.com/package/metalmind) · current release `v0.23.0`.

**From source (for hacking on metalmind itself):**

```bash
git clone https://github.com/Nikitzu/metalmind.git
cd metalmind/cli
pnpm install && pnpm build && pnpm link --global
metalmind init
```

`metalmind init` detects `~/.claude/`, `~/.codex/`, and `~/.cursor/` and shows a multi-select prompt - stamps only the hosts you choose. Skip the prompt with `--host`:

```bash
metalmind init --host claude          # Claude Code only
metalmind init --host codex           # Codex CLI only
metalmind init --host cursor          # Cursor only
metalmind init --host both            # Claude Code + Codex (when both are detected)
metalmind init --host all             # every detected host
metalmind init --host codex --with-mcp   # Codex + opt-in MCP server
```

The wizard walks five steps: prereq check (Python + uv + git + at least one supported host), vault scaffold, Python engines via `uv tool install` (sqlite-vec + fastembed bundled), watcher service (launchd on macOS, systemd on Linux), then per-host stamping. See the [install-flow diagram](https://metalmind.mzyx.dev/#demo) for what each step does.

**Just want to try the memory thesis?** `metalmind init --core` installs the memory surface only - recall, `scribe`, the stamped `CLAUDE.md` block, the rules, and `uninstall`. It skips Serena, the 15 subagents, the team commands, and `synod`: 10 files instead of 40, and it stops asking about the workflow layer. `--core` narrows the defaults, it does not override you - pass `--teams` or `--serena` alongside it and you get those. Re-run `metalmind init` without `--core` whenever you want the rest; nothing is lost by starting small.

## Requirements

**Supported hosts (v0.9.0+): [Claude Code](https://claude.ai/code), [Codex CLI](https://github.com/openai/codex) (terminal), and [Cursor](https://cursor.com).** On Cursor, recall rides on the `metalmind-recall` skill rather than a session-start hook (the hook is stamped but latent until Cursor restores `sessionStart` additional context). The Codex desktop app (`codex app`) is on the v1.1 roadmap but not yet shipped. Copilot and Gemini CLI remain on the longer-term roadmap.

- macOS or Linux (WSL2 works; native Windows not supported)
- At least one supported host: [Claude Code CLI](https://claude.ai/code) v2.1+, Codex CLI, or Cursor
- Python 3.11+, [uv](https://docs.astral.sh/uv/), git, Node 20+

Run `metalmind pulse` (alias: `doctor`) any time to check environment + install state.

## Commands

Every themed (Scadrial) verb has a classic alias. Both always resolve - theming is cosmetic.

| Scadrial | Classic | What it does |
|---|---|---|
| `metalmind init` | `metalmind init` | Interactive setup wizard |
| `metalmind pulse` | `metalmind doctor` | Verify install state |
| `metalmind store copper <insight>` | `metalmind save <insight>` | Deposit a decision into the vault |
| `metalmind tap copper "<query>"` | `metalmind recall "<query>"` | Recall - add `--deep` or `--expand` for more depth |
| `metalmind burn iron <symbol>` | `metalmind symbol <symbol>` | Find where a symbol is declared |
| `metalmind burn steel <old> <new>` | `metalmind rename <old> <new>` | Coordinated rename |
| `metalmind burn zinc "<bug>"` | `metalmind debug "<bug>"` | Dispatch `/team-debug` |
| `metalmind forge <…>` | `metalmind group <…>` | Cross-repo graph groups; `forge capture-spec` seeds OpenAPI shelf |
| `metalmind scribe <verb>` | `metalmind note <verb>` | Vault CRUD: `create \| update \| patch \| supersede \| delete \| archive \| rename \| list \| show` |
| `metalmind atium new \| add` | `metalmind daily new \| add` | Future daily notes - `--date today\|tomorrow\|next-workday\|YYYY-MM-DD`, `--from` carries unchecked items |
| `metalmind gold <note>` | `metalmind scribe archive <note>` | One-shot archive - move note to `Archive/` |
| `metalmind duralumin` | `metalmind sync` | Commit and push the vault, refusing change sets that look like note loss |
| `metalmind flare banner\|dialog\|sticky` | `metalmind notify banner\|dialog\|sticky` | macOS desktop notifications |
| `metalmind routine install eod` | `metalmind routine install eod` | Launchd EOD agent - carries unchecked items to next workday and archives today's note, Mon-Fri |
| `metalmind release-check` | `metalmind release-check` | Preflight - working tree, branch, version sync, tests, build, stamped-block present |
| `metalmind burn brass` | `metalmind stamp` | Re-imprint metalmind managed files (upgrade in place) |
| `metalmind burn tin` | `metalmind verbose` | Toggle verbose recall metadata on/off |
| `metalmind burn aluminum` | `metalmind uninstall` | Reversible teardown |

Pick a flavor during `init` - it only changes which variant your stamped `CLAUDE.md` recommends to Claude. The CLI always accepts both.

## Under the metalmind

One verb, one job. Each engine is swappable:

| Concern | Engine |
|---|---|
| Semantic recall | [sqlite-vec](https://github.com/asg017/sqlite-vec) + [fastembed](https://github.com/qdrant/fastembed), `BAAI/bge-small-en-v1.5`, all in-process |
| Vault | Plain markdown at `~/Knowledge/` ([Obsidian](https://obsidian.md)-compatible, not required) |
| Symbol navigation + rename | [Serena](https://github.com/oraios/serena) (LSP-backed) |
| Within-repo code graph (optional companion) | [codegraph](https://github.com/colbymchenry/codegraph) |
| Incremental indexing | [watchfiles](https://github.com/samuelcolvin/watchfiles) + launchd / systemd |
| Forge (cross-repo merge) | metalmind itself - HTTP-route match + name-match edges with provenance |

Your notes, embeddings, and code graphs never leave your machine. The only network calls metalmind makes are the ones you already make to Claude Code's own API.

## Uninstall

```bash
metalmind uninstall
```

Unloads the watcher service, strips the metalmind managed blocks from `~/.claude/CLAUDE.md` and `<vault>/CLAUDE.md` (user content outside the sentinel markers is preserved), removes the SessionStart hook + its entry in `~/.claude/settings.json` (other hooks stay), strips MCP entries, clears `CLAUDE_CODE_DISABLE_AUTO_MEMORY` from settings, restores your prior output-style, and removes shell aliases. Interactive prompts ask whether to also `uv tool uninstall` Serena and `metalmind-vault-rag`, and whether to remove the embedding index (keep it if you don't want to re-embed the vault). On a machine that ran the pre-v0.16.0 Qdrant + Ollama stack it also stops those containers, removes `<vault>/.metalmind-stack/`, and offers to drop their volumes.

**Never touches your notes.**

## Docs

- [`docs/architecture.md`](docs/architecture.md) - module overview + how the six modules share state
- [`docs/cookbook.md`](docs/cookbook.md) - opinionated patterns for using each module well
- [`CHANGELOG.md`](CHANGELOG.md) - release notes, one entry per tag
- [`docs/prerequisites.md`](docs/prerequisites.md) - what to install before `metalmind init`
- [`docs/post-install.md`](docs/post-install.md) - verification + troubleshooting
- [`docs/customization.md`](docs/customization.md) - swapping embedding model, relocating vault, etc.
- [`docs/plugins.md`](docs/plugins.md) - recommended Claude Code plugins
- [`docs/teams.md`](docs/teams.md) - the experimental agent-teams feature
- [`bench/recall-v0/`](bench/recall-v0/) · [`bench/mcp-tax-v0/`](bench/mcp-tax-v0/) · [`bench/recall-at-scale/`](bench/recall-at-scale/) - reproducible benches

## Hacking on the CLI

Dev setup lives in [`cli/README.md`](cli/README.md).

## License

MIT - see [`LICENSE`](LICENSE). Inspired by Brandon Sanderson's Mistborn Era 1 novels. Not affiliated.
