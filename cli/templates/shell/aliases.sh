#!/usr/bin/env bash
# metalmind aliases — sourced from ~/.zshrc / ~/.bashrc by metalmind init.
# Regenerated on each `metalmind init`; do not hand-edit.

export VAULT_PATH="${VAULT_PATH:-$HOME/Knowledge}"
METALMIND_STACK="$VAULT_PATH/.metalmind-stack"

# Docker stack control (requires docker daemon running)
alias vault-up='docker compose -f "$METALMIND_STACK/compose.yml" up -d'
alias vault-down='docker compose -f "$METALMIND_STACK/compose.yml" down'
alias vault-status='docker compose -f "$METALMIND_STACK/compose.yml" ps'
alias vault-logs='docker compose -f "$METALMIND_STACK/compose.yml" logs -f --tail=100'

# Indexer + doctor run as uv-tool-installed bins on PATH
alias vault-index='metalmind-vault-rag-indexer'
alias vault-doctor='metalmind-vault-rag-doctor'

# Watcher service control — platform-aware
case "$(uname -s)" in
    Darwin)
        _METALMIND_PLIST="$HOME/Library/LaunchAgents/com.metalmind.vault-indexer.plist"
        alias vault-watcher-start='launchctl load "$_METALMIND_PLIST"'
        alias vault-watcher-stop='launchctl unload "$_METALMIND_PLIST"'
        alias vault-watcher-status='launchctl list | grep metalmind || echo "metalmind watcher not loaded"'
        ;;
    Linux)
        alias vault-watcher-start='systemctl --user start metalmind-vault-indexer.service'
        alias vault-watcher-stop='systemctl --user stop metalmind-vault-indexer.service'
        alias vault-watcher-status='systemctl --user status metalmind-vault-indexer.service'
        ;;
esac
