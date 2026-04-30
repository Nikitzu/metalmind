# Prerequisites

The installer fails fast if anything is missing. Install these first.

## Platforms

Tested on macOS 14+ (Apple Silicon; Intel Macs should work) and Ubuntu 22.04+ / Debian 12+ via WSL2 or native. Native Windows is not supported — WSL2 works via the Linux path.

## Obsidian (optional but recommended)

[obsidian.md](https://obsidian.md/). On first launch, open or create a vault at your chosen path (default `~/Knowledge/`). The installer will add the expected folder structure and a managed block in `CLAUDE.md`.

## uv

Fast Python package manager from Astral. The wizard uses it to install `metalmind-vault-rag` (and its embedded sqlite-vec + fastembed deps) into an isolated tool venv at `~/.local/share/uv/tools/`.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Or `brew install uv`.

## Claude Code CLI

Install via the [official instructions](https://docs.claude.com/en/docs/claude-code/overview). Log in — `claude` on the command line should work. v2.1+ recommended.

## Python 3.11+

Usually present on macOS and modern Linux. `metalmind init` probes `python3`, `python3.13`, `python3.12`, and `python3.11` in that order.

## Everything else

`git`, `zsh` or `bash`, `curl`.

## Quick check

```bash
git --version && uv --version && python3 --version && claude --version
```

If all four print versions, you're ready. The default install runs the entire retrieval stack in-process — no Docker, no Ollama daemon.

## Legacy backend (`--legacy`)

If you specifically want the older Qdrant + Ollama Docker stack — useful when you already run Qdrant for other projects, or want to swap in your own Ollama-hosted embedding model — pass `--legacy` to `metalmind init`. That path additionally requires:

- [Docker](https://www.docker.com) running (Docker Desktop on macOS, Docker Engine on Linux)
- ~1.5 GB free disk for the `qdrant/qdrant` and `ollama/ollama` images plus the `nomic-embed-text` weights

The wizard will set up two containers (`metalmind-qdrant`, `metalmind-ollama`) at `<vault>/.metalmind-stack/` via `docker compose`.
