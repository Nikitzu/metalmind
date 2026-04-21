# How `fixtures/mem0.json` was captured

**Source:** [`pinkpixel-dev/mem0-mcp`](https://github.com/pinkpixel-dev/mem0-mcp) — the most-starred mem0 MCP server on GitHub (93★ as of 2026-04-21), widely referenced in mem0 docs.

**Method:** Copied verbatim from `src/index.ts` `setupToolHandlers()` — the `ListToolsRequestSchema` handler that MCP hosts (Claude Code, Cursor, Codex) call on startup to register the tool set. This is the exact manifest Claude sees.

```bash
gh api repos/pinkpixel-dev/mem0-mcp/contents/src/index.ts --jq '.content' | base64 -d > /tmp/mem0-index.ts
# Tools are defined as literal objects in the ListToolsRequestSchema handler, lines ~260–435.
```

**Why this captures the tax:**

- The MCP protocol serializes every listed tool's `name`, `description`, and `input_schema` (including optional properties with their descriptions) into the system prompt.
- There is no "only-required-fields" wire format. Descriptions count.
- Cloud-API properties stay in the manifest even for self-hosted installs — they're defined unconditionally.

**What to re-run if mem0 updates its server:**

```bash
gh api repos/pinkpixel-dev/mem0-mcp/contents/src/index.ts --jq '.content' | base64 -d
# Find the ListToolsRequestSchema handler; copy each tool's name/description/inputSchema
# into fixtures/mem0.json, converting JS object literals to JSON.
```

**Alternatives not captured in v0:**

- `elvismdev/mem0-mcp-selfhosted` (73★) — fork, similar schema, not captured.
- `Major-wagh/mem0-mcp-server` (0★) — trivial fork.
- Letta's Rust MCP server (`oculairmedia/Letta-MCP-server`, 68★) — tools sprawl across `letta-server/src/tools/**/*.rs` with dynamic schema assembly. Re-capture is non-trivial; deferred to v1.
