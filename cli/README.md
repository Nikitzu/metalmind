# metalmind CLI

The Node/TypeScript CLI that drives `metalmind init`, `pulse`, `tap copper`, `burn bronze`, etc. Published as the [`metalmind`](https://www.npmjs.com/package/metalmind) npm package (imminent).

**For users**: see the repo root [`README.md`](../README.md). This file is for hacking on the CLI.

## Layout

```
cli/
├── src/
│   ├── cli.ts                 Commander entry + command wiring
│   ├── commands/              Verb implementations (init, tap, burn, store, …)
│   ├── install/               Wizard + per-concern installers
│   │   ├── wizard.ts          Orchestration
│   │   ├── prereqs.ts         Platform + tool detection
│   │   ├── vault.ts           Obsidian vault scaffold
│   │   ├── serena.ts          Serena install via uv tool
│   │   ├── graphify.ts        graphify install via uv tool
│   │   ├── vault-rag.ts       metalmind-vault-rag install via uv tool
│   │   ├── stack.ts           Docker compose up + model pull
│   │   ├── watcher.ts         Platform dispatcher (launchd | systemd)
│   │   ├── launchd.ts         macOS watcher install
│   │   ├── systemd.ts         Linux watcher install
│   │   ├── mcp.ts             ~/.claude.json edits
│   │   ├── settings.ts        ~/.claude/settings.json env edits
│   │   ├── aliases.ts         Shell rc source-line injection
│   │   ├── templates.ts       CLAUDE.md stamps + rules copy
│   │   ├── output-style.ts    Output-style migration
│   │   └── teardown.ts        Reversible uninstall
│   ├── backends/              MCP client + recall/graph/vault backends
│   ├── forge/                 Cross-repo graph groups
│   └── config.ts              Zod schema for ~/.metalmind/config.json
├── templates/                 Bundled at publish time via `files`
│   ├── metalmind-stack/       compose.yml for Qdrant + Ollama
│   ├── vault-rag-pkg/         Python package source (installed via uv tool)
│   ├── vault/                 CLAUDE.md.template for the Obsidian vault
│   ├── claude/                Global CLAUDE.md + rules + agents + commands
│   ├── launchd/               macOS plist template
│   ├── systemd/               Linux .service template
│   └── zsh/                   aliases.sh
├── tsup.config.ts             Bundler config (ESM, node20 target)
└── package.json
```

**1 file = 1 instance**: each installer lives in its own file with a single `install<Thing>()` + `uninstall<Thing>()` pair. Wizard composes them; teardown reverses.

## Dev loop

```bash
pnpm install
pnpm dev               # tsx watch — runs src/cli.ts directly
pnpm typecheck         # tsc --noEmit
pnpm test              # vitest run (121 tests)
pnpm test:watch
pnpm build             # tsup → dist/cli.js (ESM, shebang, node20)
```

After a build, the installed shim picks up new code immediately (pnpm / npm global links resolve through the local `dist/cli.js`).

## Testing conventions

- **Vitest** with `vi.hoisted()` for `runCommand` mocks — lets tests simulate uv / docker / launchctl / systemctl without touching the real system.
- **Temp dirs** for all filesystem side-effects (`mkdtemp` in `beforeEach`, `rm -rf` in `afterEach`).
- **Path overrides** on every installer — every function that writes to `~/.claude.json` / `~/Library/LaunchAgents` / `~/.config/systemd` accepts an override so tests can redirect to a temp path.
- **No real network**: `setupStack` takes a `fetchFn` for polling; tests pass a fake that returns 200 immediately.

Each installer has a mirror `*.test.ts` next to it — add tests alongside the code you touch.

## Adding a new install step

1. Create `src/install/<thing>.ts` with `install<Thing>(): Promise<...>` + `uninstall<Thing>(): Promise<...>`. Return a result object so callers can log what happened.
2. Accept path overrides as options (`<thingPath>?: string`) for testability.
3. Wire into `src/install/wizard.ts` — a `log.step(...)` + success line.
4. Wire the inverse into `src/install/teardown.ts`.
5. Add tests under `src/install/<thing>.test.ts` following the existing mock pattern.

## Bundling the Python package

`metalmind-vault-rag` is a standalone Python package at `templates/vault-rag-pkg/`. It ships inside the npm tarball (via `files: ["templates"]`) and installs on the user's machine with `uv tool install --from <bundled-path> metalmind-vault-rag`. Four binaries land on PATH: `metalmind-vault-rag-{server,watcher,indexer,doctor}`.

To iterate on the Python side:

```bash
cd cli/templates/vault-rag-pkg
uv tool install --reinstall --force --from . metalmind-vault-rag
# reload watcher if running:
launchctl unload ~/Library/LaunchAgents/com.metalmind.vault-indexer.plist   # macOS
launchctl load ~/Library/LaunchAgents/com.metalmind.vault-indexer.plist
# or on Linux:
systemctl --user restart metalmind-vault-indexer.service
```

## Publishing

```bash
pnpm build
pnpm test
npm pack --dry-run     # sanity-check tarball contents + size
npm version <patch|minor|major>
npm publish --access public
git push --follow-tags
```

Before the first publish: make sure `npm whoami` returns the intended account.

## Philosophy

- **No hidden state**: every side-effect has a corresponding teardown. Users who run `metalmind uninstall` should be able to verify with their own eyes that we left nothing behind (except their notes, which we never touched).
- **Idempotent**: re-running `metalmind init` is safe and should converge to the same state.
- **Skill-first over MCP**: when a CLI call works, prefer it over registering an MCP tool — MCP schemas get injected into every session and cost tokens.
- **Thin vertical slices**: prefer ~100-line commits that each leave the system green. See `.claude/rules/principles.md`.
