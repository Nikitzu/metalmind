# Prerequisites

The installer fails fast if anything is missing. Install these first.

## macOS

Tested on macOS 14+ (Sonoma) on Apple Silicon. Intel Macs should work. Linux is untested — `launchd` is macOS-specific; you'd need a systemd user unit equivalent.

## Obsidian

Download from [obsidian.md](https://obsidian.md/).

On first launch, **create an empty vault** at your chosen path (default `~/Knowledge/`). The installer will add the expected folder structure and a `CLAUDE.md` to it.

## Docker Desktop

Download from [docker.com](https://www.docker.com/products/docker-desktop).

The stack uses two small containers:

- `ollama/ollama` — runs the embedding model
- `qdrant/qdrant` — stores vectors

Resource caps are set in `compose.yml`: 1 GB RAM for Ollama, 512 MB for Qdrant. You can lower these if needed.

Make sure Docker Desktop is **running** before install.

## uv

Fast Python package manager from Astral.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Or `brew install uv`.

## Claude Code CLI

Install via the [official instructions](https://docs.claude.com/en/docs/claude-code/overview). You need to be logged in (`claude` on the command line should work).

## Everything else

Usually already present on macOS: `git`, `python3` (≥ 3.11), `zsh`, `curl`.

## Quick check

```bash
git --version && docker --version && uv --version && python3 --version && claude --version
docker info >/dev/null && echo "docker daemon ok"
```

If all five print versions and "docker daemon ok" appears — you're ready.
