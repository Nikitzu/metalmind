# metalmind vault-stack aliases
# Source this from ~/.zshrc:  source ~/.metalmind/aliases.sh
# VAULT_PATH is exported so the Python code picks it up.

export VAULT_PATH="${VAULT_PATH:-$HOME/Knowledge}"
VAULT_STACK="$VAULT_PATH/.metalmind-stack"

alias vault-up='docker compose -f "$VAULT_STACK/compose.yml" up -d'
alias vault-down='docker compose -f "$VAULT_STACK/compose.yml" down'
alias vault-status='docker compose -f "$VAULT_STACK/compose.yml" ps'
alias vault-logs='docker compose -f "$VAULT_STACK/compose.yml" logs -f --tail=100'
alias vault-index='uv run --directory "$VAULT_STACK/vault_rag" python indexer.py'
alias vault-doctor='uv run --directory "$VAULT_STACK/vault_rag" python doctor.py'
alias vault-watcher-start='launchctl load ~/Library/LaunchAgents/com.metalmind.vault-indexer.plist'
alias vault-watcher-stop='launchctl unload ~/Library/LaunchAgents/com.metalmind.vault-indexer.plist'
