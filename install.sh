#!/usr/bin/env bash
# claude-knowledge-stack — interactive installer.
# Idempotent: safe to re-run. Merges into existing config — never overwrites.
# Pass --yes / -y for non-interactive re-runs with current defaults.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$REPO_DIR/templates"
NONINTERACTIVE=0
DRY=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) NONINTERACTIVE=1 ;;
    -n|--dry-run) DRY=1 ;;
    -h|--help) echo "Usage: $0 [--yes|-y] [--dry-run|-n]"; exit 0 ;;
  esac
done

# ---------- output helpers ----------
BOLD=$(tput bold 2>/dev/null || true); RESET=$(tput sgr0 2>/dev/null || true)
G=$(tput setaf 2 2>/dev/null || true); Y=$(tput setaf 3 2>/dev/null || true); R=$(tput setaf 1 2>/dev/null || true); C=$(tput setaf 6 2>/dev/null || true)

hdr()  { printf "\n${BOLD}${C}━━━ %s ━━━${RESET}\n" "$*"; }
ok()   { printf "${G}✓${RESET} %s\n" "$*"; }
warn() { printf "${Y}↷${RESET} %s\n" "$*"; }
err()  { printf "${R}✗${RESET} %s\n" "$*" >&2; }
info() { printf "  %s\n" "$*"; }

ask_yn() {
  local prompt="$1" default="${2:-Y}" ans
  if [ "$NONINTERACTIVE" = 1 ]; then
    [[ "$default" =~ ^[Yy]$ ]]; return
  fi
  local hint="[Y/n]"; [[ "$default" =~ ^[Nn]$ ]] && hint="[y/N]"
  read -r -p "${prompt} ${hint} " ans
  ans="${ans:-$default}"
  [[ "$ans" =~ ^[Yy]$ ]]
}
ask_val() {
  local prompt="$1" default="$2" ans
  if [ "$NONINTERACTIVE" = 1 ]; then echo "$default"; return; fi
  read -r -p "${prompt} [${default}]: " ans
  echo "${ans:-$default}"
}

# ---------- banner ----------
clear 2>/dev/null || true
cat <<'BANNER'
  ╔═══════════════════════════════════════════════════════════╗
  ║         claude-knowledge-stack — interactive setup        ║
  ║                                                           ║
  ║   Obsidian vault · local semantic search · Serena · agents║
  ╚═══════════════════════════════════════════════════════════╝
BANNER

# ---------- prereq check ----------
hdr "1/5  Prerequisite check"

need() { command -v "$1" >/dev/null 2>&1 || { err "missing: $1 — see docs/prerequisites.md"; exit 1; }; }
need git; need docker; need uv; need python3
docker info >/dev/null 2>&1 || { err "Docker daemon not running"; exit 1; }
ok "git, docker (running), uv, python3 present"
UV_BIN="$(command -v uv)"

if command -v claude >/dev/null 2>&1; then
  CC_VER="$(claude --version 2>/dev/null | head -1 || echo '(unknown)')"
  ok "Claude Code CLI: $CC_VER"
else
  warn "claude CLI not on PATH — install Claude Code before restarting your session (see prerequisites.md)"
fi

# ---------- interactive questions ----------
hdr "2/5  Choose what to install"

VAULT_DEFAULT="$HOME/Knowledge"
VAULT_PATH="${VAULT_PATH:-$(ask_val "Obsidian vault path" "$VAULT_DEFAULT")}"
VAULT_PATH="${VAULT_PATH/#\~/$HOME}"

echo ""
info "Serena gives Claude symbol-level navigation over your repos (10-30× fewer tokens on code questions)."
INSTALL_SERENA=0; ask_yn "Install Serena (offline-first, clones locally)?" Y && INSTALL_SERENA=1

echo ""
info "Agent teams spawn parallel Claude sessions that message each other. Experimental in Claude Code."
ENABLE_TEAMS=0; ask_yn "Enable agent teams (+ install 4 /team-* commands)?" Y && ENABLE_TEAMS=1

INSTALL_IT2=0
if [ "$ENABLE_TEAMS" = 1 ]; then
  info "iTerm2 split panes let each teammate have its own pane instead of cycling in one terminal."
  info "Requires 'brew install mkusaka/tap/it2' + enabling iTerm2 Python API. Skippable — in-process mode works everywhere."
  ask_yn "Set up iTerm2 split panes for teams?" N && INSTALL_IT2=1
fi

echo ""
info "Plugin pack: superpowers, context7, commit-commands, code-review, claude-md-management, hookify, ui-ux-pro-max."
INSTALL_PLUGINS=0; ask_yn "Install recommended plugin pack after core setup?" Y && INSTALL_PLUGINS=1

# ---------- review ----------
hdr "3/5  Review"
info "Vault path:        $VAULT_PATH"
info "Core stack:        ${G}yes${RESET}  (vault indexer, watcher, MCP server, Ollama + Qdrant, 15 agents, /save, rules)"
info "Serena:            $([ "$INSTALL_SERENA" = 1 ] && echo "${G}yes${RESET}" || echo "${Y}skip${RESET}")"
info "Agent teams:       $([ "$ENABLE_TEAMS" = 1 ]   && echo "${G}yes${RESET}" || echo "${Y}skip${RESET}")"
info "iTerm2 for teams:  $([ "$INSTALL_IT2" = 1 ]    && echo "${G}yes${RESET}" || echo "${Y}skip${RESET}")"
info "Plugin pack:       $([ "$INSTALL_PLUGINS" = 1 ] && echo "${G}yes (after core)${RESET}" || echo "${Y}skip${RESET}")"
echo ""
if [ "$DRY" = 1 ]; then
  hdr "DRY RUN — nothing will be modified"
  info "Would write to:"
  info "  $VAULT_PATH/          (vault folders + CLAUDE.md if missing)"
  info "  $VAULT_PATH/.claude-stack/          (compose.yml, vault_rag/)"
  info "  ~/.claude/rules/            (principles.md, tool-philosophy.md, security-boundaries.md, api-design.md)"
  info "  ~/.claude/commands/         (save.md$([ "$ENABLE_TEAMS" = 1 ] && echo ', team-*.md x4'))"
  info "  ~/.claude/agents/           (15 agent files)"
  info "  ~/.claude/CLAUDE.md         (from template, only if missing)"
  info "  ~/.claude/settings.json     (merge: env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=$([ "$ENABLE_TEAMS" = 1 ] && echo '1' || echo 'unset'))"
  info "  ~/.claude.json              (merge: mcpServers.vault-rag$([ "$INSTALL_SERENA" = 1 ] && echo ', mcpServers.serena')$([ "$ENABLE_TEAMS" = 1 ] && echo ', teammateMode=auto'))"
  $([ "$INSTALL_SERENA" = 1 ] && echo info "  ~/.serena/src/serena/       (git clone oraios/serena)")
  $([ "$INSTALL_SERENA" = 1 ] && echo info "  ~/.serena/serena_config.yml (from template, only if missing)")
  info "  ~/.gitignore_global         (append .claude/, .serena/, CLAUDE.md, CLAUDE.local.md)"
  info "  ~/.claude-knowledge-stack/aliases.sh   (+ source line added to ~/.zshrc)"
  info "  ~/Library/LaunchAgents/com.claude.vault-indexer.plist   (if missing)"
  info ""
  info "Would execute:"
  info "  uv sync (in $VAULT_PATH/.claude-stack/vault_rag)"
  info "  docker compose up -d (Ollama + Qdrant containers)"
  info "  ollama pull nomic-embed-text (one-time ~274 MB download)"
  info "  uv run python indexer.py (initial vault index)"
  info "  launchctl load <plist> (auto-reindex watcher)"
  $([ "$INSTALL_IT2" = 1 ] && echo info "  brew install mkusaka/tap/it2 (iTerm2 split-pane CLI)")
  $([ "$INSTALL_PLUGINS" = 1 ] && echo info "  ./install-plugins.sh (recommended plugin pack)")
  info ""
  info "Will NOT touch:"
  info "  Existing ~/.claude/CLAUDE.md, rules, agents, commands — cp -n preserves them"
  info "  Existing MCP entries in ~/.claude.json — merge only adds missing keys"
  info "  Your Obsidian notes — only creates missing folders, never modifies files"
  info "  ~/.env or any credential files"
  echo ""
  ok "Dry run complete. Run without --dry-run to execute."
  exit 0
fi
ask_yn "Proceed with install?" Y || { warn "aborted"; exit 0; }

# ---------- core install ----------
hdr "4/5  Installing"

mkdir -p "$VAULT_PATH"/{Work,Personal,Learnings,Daily,Inbox,Archive,Memory}
mkdir -p "$VAULT_PATH/.claude-stack"

[ ! -f "$VAULT_PATH/CLAUDE.md" ] && cp "$T/vault/CLAUDE.md" "$VAULT_PATH/CLAUDE.md" && ok "wrote vault CLAUDE.md" \
  || warn "vault CLAUDE.md exists — kept"

cp "$T/claude-stack/compose.yml" "$VAULT_PATH/.claude-stack/compose.yml"
mkdir -p "$VAULT_PATH/.claude-stack/vault_rag"
cp -R "$T/claude-stack/vault_rag/." "$VAULT_PATH/.claude-stack/vault_rag/"
ok "copied stack into $VAULT_PATH/.claude-stack/"

mkdir -p ~/.claude/rules ~/.claude/commands ~/.claude/agents
cp -n "$T/claude/rules/"*.md ~/.claude/rules/ 2>/dev/null || true
cp -n "$T/claude/commands/save.md" ~/.claude/commands/save.md 2>/dev/null || true
cp -n "$T/claude/agents/"*.md ~/.claude/agents/ 2>/dev/null || true
ok "copied rules, /save, 15 agents"

CLAUDE_MD="$HOME/.claude/CLAUDE.md"
if [ ! -f "$CLAUDE_MD" ]; then
  sed "s|{{VAULT_PATH}}|$VAULT_PATH|g" "$T/claude/CLAUDE.md.template" > "$CLAUDE_MD"
  ok "wrote $CLAUDE_MD"
else
  warn "$CLAUDE_MD exists — kept. Template at $T/claude/CLAUDE.md.template"
fi

# ---------- team commands (opt-in) ----------
if [ "$ENABLE_TEAMS" = 1 ]; then
  cp -n "$T/claude/commands/team-"*.md ~/.claude/commands/ 2>/dev/null || true
  ok "installed /team-debug /team-feature /team-pr-review /team-multi-repo-audit"
fi

# ---------- Serena (opt-in) ----------
if [ "$INSTALL_SERENA" = 1 ]; then
  mkdir -p ~/.serena/src
  if [ ! -d ~/.serena/src/serena/.git ]; then
    git clone --depth 1 https://github.com/oraios/serena ~/.serena/src/serena
    ok "cloned Serena to ~/.serena/src/serena"
  else
    warn "Serena clone exists — kept"
  fi
  if [ ! -f ~/.serena/serena_config.yml ]; then
    sed "s|{{HOME}}|$HOME|g" "$T/serena/serena_config.yml" > ~/.serena/serena_config.yml
    ok "wrote ~/.serena/serena_config.yml"
  else
    warn "~/.serena/serena_config.yml exists — kept"
  fi
fi

# ---------- iTerm2 it2 CLI (opt-in) ----------
if [ "$INSTALL_IT2" = 1 ]; then
  if command -v it2 >/dev/null 2>&1; then
    ok "it2 CLI already installed"
  elif command -v brew >/dev/null 2>&1; then
    brew install mkusaka/tap/it2 && ok "installed it2 via brew" || warn "brew install it2 failed — install manually later"
  else
    warn "brew not found — install it2 manually: https://github.com/mkusaka/it2"
  fi
  warn "iTerm2 Python API must be enabled MANUALLY: iTerm2 → Settings → General → Magic → Enable Python API"
fi

# ---------- global gitignore ----------
GI="$(git config --global --get core.excludesfile || true)"
GI="${GI:-$HOME/.gitignore_global}"
touch "$GI"
git config --global core.excludesfile "$GI"
for pat in '.claude/' '.serena/' 'CLAUDE.md' 'CLAUDE.local.md'; do
  grep -qxF "$pat" "$GI" || echo "$pat" >> "$GI"
done
ok "global gitignore covers .claude/, .serena/, CLAUDE.md, CLAUDE.local.md"

# ---------- ~/.claude.json: MCP + teammateMode ----------
VAULT_PATH="$VAULT_PATH" INSTALL_SERENA="$INSTALL_SERENA" ENABLE_TEAMS="$ENABLE_TEAMS" python3 <<'PY'
import json, os, pathlib, shutil
p = pathlib.Path.home() / ".claude.json"
d = json.loads(p.read_text()) if p.exists() else {}
ms = d.setdefault("mcpServers", {})
vault_py = os.environ["VAULT_PATH"] + "/.claude-stack/vault_rag"
if "vault-rag" not in ms:
    ms["vault-rag"] = {
        "type": "stdio",
        "command": "uv",
        "args": ["run", "--directory", vault_py, "python", "server.py"],
        "env": {"VAULT_PATH": os.environ["VAULT_PATH"]},
    }
if os.environ["INSTALL_SERENA"] == "1" and "serena" not in ms:
    ms["serena"] = {
        "type": "stdio",
        "command": "uvx",
        "args": ["--from", str(pathlib.Path.home()/".serena/src/serena"),
                 "serena", "start-mcp-server", "--context", "claude-code"],
        "env": {"SERENA_USAGE_REPORTING": "false"},
    }
if os.environ["ENABLE_TEAMS"] == "1":
    d.setdefault("teammateMode", "auto")
if p.exists():
    shutil.copy(p, str(p) + ".bak-cks")
p.write_text(json.dumps(d, indent=2))
print("✓ merged MCP servers + teammateMode into ~/.claude.json")
PY

# ---------- settings.json: teams flag ----------
if [ "$ENABLE_TEAMS" = 1 ]; then
python3 <<'PY'
import json, pathlib, shutil
p = pathlib.Path.home() / ".claude/settings.json"
p.parent.mkdir(parents=True, exist_ok=True)
d = json.loads(p.read_text()) if p.exists() else {}
env = d.setdefault("env", {})
env.setdefault("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
if p.exists():
    shutil.copy(p, str(p) + ".bak-cks")
p.write_text(json.dumps(d, indent=2))
print("✓ set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in ~/.claude/settings.json")
PY
fi

# ---------- aliases ----------
mkdir -p ~/.claude-knowledge-stack
cp "$T/zsh/aliases.sh" ~/.claude-knowledge-stack/aliases.sh
LINE='[ -f ~/.claude-knowledge-stack/aliases.sh ] && source ~/.claude-knowledge-stack/aliases.sh'
if [ -f ~/.zshrc ] && ! grep -qF "$LINE" ~/.zshrc; then
  echo "$LINE" >> ~/.zshrc
  ok "added aliases source line to ~/.zshrc"
elif [ ! -f ~/.zshrc ]; then
  warn "no ~/.zshrc — add this line manually: $LINE"
fi

# ---------- launchd watcher ----------
PLIST=~/Library/LaunchAgents/com.claude.vault-indexer.plist
if [ ! -f "$PLIST" ]; then
  sed -e "s|{{VAULT_PATH}}|$VAULT_PATH|g" -e "s|{{UV_PATH}}|$UV_BIN|g" \
    "$T/launchd/com.claude.vault-indexer.plist.template" > "$PLIST"
  ok "wrote launchd plist"
else
  warn "launchd plist exists — kept"
fi

# ---------- vault_rag deps + stack + index ----------
info "installing vault_rag Python deps..."
( cd "$VAULT_PATH/.claude-stack/vault_rag" && uv sync >/dev/null )
ok "deps installed"

info "starting Docker stack (Ollama + Qdrant)..."
docker compose -f "$VAULT_PATH/.claude-stack/compose.yml" up -d >/dev/null
for i in $(seq 1 60); do
  curl -sf http://localhost:11434/api/tags >/dev/null 2>&1 && break
  sleep 2
done
ok "stack up"

info "pulling nomic-embed-text model (~274 MB, one-time)..."
docker exec knowledge-ollama ollama pull nomic-embed-text 2>&1 | tail -2

info "building initial vault index..."
( cd "$VAULT_PATH/.claude-stack/vault_rag" && VAULT_PATH="$VAULT_PATH" uv run python indexer.py >/dev/null )
ok "index built"

launchctl load "$PLIST" 2>/dev/null || launchctl bootstrap "gui/$UID" "$PLIST" 2>/dev/null || true
ok "watcher loaded (auto-reindex on changes)"

# ---------- optional plugin pack ----------
if [ "$INSTALL_PLUGINS" = 1 ]; then
  hdr "5a/5  Installing plugin pack"
  if command -v claude >/dev/null 2>&1; then
    bash "$REPO_DIR/install-plugins.sh" || warn "plugin install had issues — run ./install-plugins.sh manually later"
  else
    warn "claude CLI not on PATH — skipping. Run ./install-plugins.sh after installing Claude Code."
  fi
fi

# ---------- done ----------
hdr "5/5  All done"
cat <<DONE
  Next steps:
    1. ${BOLD}Restart Claude Code${RESET} (so MCP servers load)
    2. ${BOLD}exec zsh${RESET} or open a new terminal (so aliases load)
    3. Try: /save  — to save your first note
$([ "$INSTALL_SERENA" = 1 ] && echo "    4. In Claude Code: activate_project /path/to/a/repo  — prime Serena for that repo")
$([ "$ENABLE_TEAMS" = 1 ]   && echo "    5. Try: /team-debug <bug-id>  — spawn a debug team")
$([ "$INSTALL_IT2" = 1 ]    && echo "       ⚠  Don't forget: enable iTerm2 Python API manually (Settings → General → Magic)")

  Docs:  docs/post-install.md · docs/customization.md · docs/teams.md
  Aliases: vault-status · vault-doctor · vault-index · vault-logs
DONE
