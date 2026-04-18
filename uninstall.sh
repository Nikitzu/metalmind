#!/usr/bin/env bash
# Reverses install.sh. Preserves vault content — never deletes your notes.

set -euo pipefail
c_y() { printf '\033[0;33m%s\033[0m\n' "$*"; }
c_g() { printf '\033[0;32m%s\033[0m\n' "$*"; }

VAULT_PATH="${VAULT_PATH:-$HOME/Knowledge}"

c_y "This will:"
c_y "  - stop watcher and Docker stack"
c_y "  - remove $VAULT_PATH/.claude-stack/ (stack code, NOT your notes)"
c_y "  - remove Serena clone at ~/.serena/src/"
c_y "  - remove MCP entries (vault-rag, serena) from ~/.claude.json"
c_y ""
c_y "Will NOT touch: your notes, ~/.claude/agents, ~/.claude/rules, ~/.claude/CLAUDE.md"
read -r -p "Proceed? [y/N] " ans
[[ "$ans" =~ ^[Yy]$ ]] || { c_y "aborted"; exit 0; }

PLIST=~/Library/LaunchAgents/com.claude.vault-indexer.plist
if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm "$PLIST"
  c_g "✓ watcher unloaded + plist removed"
fi

if [ -f "$VAULT_PATH/.claude-stack/compose.yml" ]; then
  docker compose -f "$VAULT_PATH/.claude-stack/compose.yml" down -v || true
  c_g "✓ Docker stack stopped and volumes removed"
fi

rm -rf "$VAULT_PATH/.claude-stack" ~/.serena/src
c_g "✓ removed stack and Serena clone"

python3 <<'PY'
import json, pathlib, shutil
p = pathlib.Path.home() / ".claude.json"
if not p.exists(): raise SystemExit
d = json.loads(p.read_text())
ms = d.get("mcpServers", {})
for k in ("vault-rag", "serena"):
    ms.pop(k, None)
shutil.copy(p, str(p)+".bak-cks-uninstall")
p.write_text(json.dumps(d, indent=2))
print("removed MCP entries from", p)
PY

c_g "== Uninstall complete =="
c_y "Your vault notes at $VAULT_PATH are untouched."
c_y "Remove aliases source line from ~/.zshrc manually if you wish."
