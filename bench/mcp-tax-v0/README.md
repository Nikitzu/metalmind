# mcp-tax-v0 — first-turn token tax bench

**Claim on the landing page:** *"Most memory tools silently inject 3–5 tool schemas into every Claude Code session before you've typed a prompt."*
**What this bench measures:** how many tokens each memory system costs you on a cold session, before any user turn.

## TL;DR

Per-session standing cost of the first-turn token tax:

| System | Transport | Tools | Tools JSON (chars) | First-turn tokens (approx) |
|---|---|---:|---:|---:|
| **metalmind** (loopback HTTP, default) | HTTP 127.0.0.1:17317 | **0** | 0 | ~519 *(one-time text block in CLAUDE.md)* |
| **metalmind** (stdio MCP fallback) | MCP stdio | 3 | 627 | ~157 |
| **mem0** (`pinkpixel-dev/mem0-mcp`) | MCP stdio | 3 | 5,276 | ~1,319 |
| **Claude Code native `/memory`** | text (CLAUDE.md hierarchy) | 0 | 0 | ~1 |

Numbers are char/4 approximations — order-of-magnitude, not exact. Anyone with an `ANTHROPIC_API_KEY` can re-run with real token counts (see *Reproducing*). The **relative shape** is what matters: two zero-schema transports, one modest-schema transport, one bloat-schema transport.

Why metalmind-loopback is ~519 tokens even though it has zero tool schemas: the `~/.claude/CLAUDE.md` block that teaches Claude *when* to call `metalmind tap copper` is ~20 lines of prose. We count it. It is a one-time text block, not a per-tool JSON schema.

## Why "tools × bloat" matters

MCP hosts serialize every registered tool's `name`, `description`, and `input_schema` (including descriptions of every optional property) into the system prompt. There is no over-the-wire pruning. If a server exposes 3 tools and each tool has 15 optional cloud-API properties with prose descriptions, you pay for all of them on every cold session — whether you use the cloud API or not.

mem0's `search_memory` alone advertises 13 optional parameters: `sessionId`, `agentId`, `appId`, `projectId`, `orgId`, `filters`, `threshold`, `topK`, `fields`, `rerank`, `keywordSearch`, `filterMemories`, and `userId`. Every Claude session pays for the prose on each.

## What this bench does NOT measure

- **Per-call cost.** Hit payloads (both metalmind and mem0) are billed like any other tool/bash result. Neither is free. The tax measured here is *standing cost* before a single call is made.
- **Recall quality.** Covered separately in [`bench/recall-v0/`](../recall-v0/). Different question.
- **Claude Code's own built-in tools** (Read/Grep/Bash/etc). Those are part of the platform contract; we compare *added memory tools*, not *platform tools*.
- **Letta.** `oculairmedia/Letta-MCP-server` is a Rust server whose tools sprawl across many files with dynamic schema assembly; capture is non-trivial. Deferred to v1. (See `scripts/capture-mem0.md` for context.)

## Methodology

1. **Capture the tool manifest** each system advertises, stored as JSON under `fixtures/`. For zero-tool systems (metalmind-loopback, Claude Code native), the tools array is empty and any standing text cost (e.g. the stamped CLAUDE.md block) is captured separately in `fixtures/metalmind-instruction-block.txt`.
2. **Count tokens** in two modes:
   - **Exact** (requires `ANTHROPIC_API_KEY`): POST each fixture to `https://api.anthropic.com/v1/messages/count_tokens` with the fixture as the `tools` parameter. Subtract the baseline count (same call with no tools) to isolate the tool-tax delta. Same for the instruction block as a `system` parameter.
   - **Approximation** (default, no key needed): `ceil(chars / 4)` over the JSON serialization. Rough but deterministic and within ~15% of exact for JSON-heavy content on Sonnet.
3. **Write** `results/results-latest.{json,csv}`.

## Reproducing

```bash
# Approximation, no key:
node bench/mcp-tax-v0/run.mjs --offline

# Exact, with a key:
ANTHROPIC_API_KEY=sk-ant-... node bench/mcp-tax-v0/run.mjs

# Override the model used for counting (default: claude-sonnet-4-5):
METALMIND_BENCH_MODEL=claude-opus-4-7 ANTHROPIC_API_KEY=... node bench/mcp-tax-v0/run.mjs
```

## Interpretation

A ~1,300-token standing cost sounds small until you multiply by every cold session across a workday — a developer running ~20 fresh `claude` invocations pays ~26k tokens/day for a memory system they may or may not call. Across a month: ~520k standing tokens, purely to *announce* that the memory system exists.

metalmind's loopback-HTTP design trades that for a ~520-token one-time instruction block (the stamped section in `~/.claude/CLAUDE.md`) and does the rest over Bash. That block is prose, not JSON schema — and prose is what the rest of `CLAUDE.md` is already made of. Claude Code natively supports CLAUDE.md-as-instructions; we lean on that, not against it.

## Limitations

- Char/4 is an approximation, not a tokenizer. Real counts may differ by ±15%.
- Fixtures are a snapshot; repos can grow or shrink their schemas. Re-capture before citing in a post.
- Tool use in real sessions varies — a session that actually calls `search_memory` pays the per-call cost too. Results tokens are billed like any other tool output across all systems, so this is not a differentiator and is excluded here.
