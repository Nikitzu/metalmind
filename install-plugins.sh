#!/usr/bin/env bash
# Installs the recommended Claude Code plugin pack.
# Opt-in — not called by install.sh. Requires Claude Code CLI on PATH.

set -euo pipefail
c_g() { printf '\033[0;32m%s\033[0m\n' "$*"; }
c_y() { printf '\033[0;33m%s\033[0m\n' "$*"; }
c_r() { printf '\033[0;31m%s\033[0m\n' "$*" >&2; }

command -v claude >/dev/null 2>&1 || { c_r "✗ 'claude' CLI not found on PATH"; exit 1; }

PLUGINS=(
  "superpowers@claude-plugins-official"
  "context7@claude-plugins-official"
  "commit-commands@claude-plugins-official"
  "code-review@claude-plugins-official"
  "claude-md-management@claude-plugins-official"
  "hookify@claude-plugins-official"
  "ui-ux-pro-max@claude-plugins-official"
)

c_g "Adding official marketplace..."
claude plugin marketplace add claude-plugins-official 2>/dev/null || true

for p in "${PLUGINS[@]}"; do
  c_g "Installing $p..."
  claude plugin install "$p" || c_y "  (may already be installed)"
done

c_g ""
c_g "=== Plugin pack installed ==="
c_y "Optional plugins you may also want (API key / config required):"
echo "  - linear@claude-plugins-official       (Linear issue tracking)"
echo "  - figma@claude-plugins-official        (Figma design integration)"
echo ""
c_y "Run /reload-plugins inside Claude Code to apply."
