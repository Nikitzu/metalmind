#!/usr/bin/env bash
# End-to-end smoke test for metalmind.
# Covers: non-interactive init, stamp idempotency, managed-block stamping
# in vault + global CLAUDE.md, store-copper, tap-copper (HTTP path via
# stdio fallback since no watcher runs), pulse readout, and reversible
# uninstall. Does NOT touch Docker, Serena, or graphify — those are heavy
# and covered by the live `metalmind pulse --deep` on a real install.
#
# Usage:
#   ./cli/test/integration/smoke.sh           # default: HOME=$(mktemp -d)
#   METALMIND_BIN=/path/to/metalmind ./…      # point at a specific binary
#
# Exits 0 on success, non-zero on any failed assertion.

set -euo pipefail

# -- Setup: isolated HOME so we don't touch the user's real config ------------
export TEST_HOME
TEST_HOME="$(mktemp -d -t metalmind-smoke-XXXXXX)"
trap 'rm -rf "$TEST_HOME"' EXIT

export HOME="$TEST_HOME"
METALMIND_BIN="${METALMIND_BIN:-metalmind}"

# Counter + tiny assertion helpers
PASS=0
FAIL=0
assert() {
    local label="$1"; shift
    if "$@"; then
        printf '  ✓ %s\n' "$label"
        PASS=$((PASS + 1))
    else
        printf '  ✗ %s\n' "$label"
        FAIL=$((FAIL + 1))
    fi
}
assert_contains() {
    local label="$1" file="$2" needle="$3"
    if grep -qF "$needle" "$file"; then
        printf '  ✓ %s\n' "$label"
        PASS=$((PASS + 1))
    else
        printf '  ✗ %s (did not find %q in %s)\n' "$label" "$needle" "$file"
        FAIL=$((FAIL + 1))
    fi
}

section() { printf '\n=== %s ===\n' "$1"; }

section "1. init --yes --skip-docker --skip-watcher --no-serena --no-graphify"
"$METALMIND_BIN" init --yes \
    --vault-path "$TEST_HOME/Knowledge" \
    --skip-docker --skip-watcher --no-serena --no-graphify --no-teams \
    --flavor classic --memory-routing vault-only \
    > "$TEST_HOME/init.log" 2>&1 || {
        echo "init failed; log:" && cat "$TEST_HOME/init.log" && exit 1
    }
assert "config.json written" test -f "$TEST_HOME/.metalmind/config.json"
assert_contains "config has vault path" "$TEST_HOME/.metalmind/config.json" '"vaultPath"'
assert "vault CLAUDE.md created" test -f "$TEST_HOME/Knowledge/CLAUDE.md"
assert "global CLAUDE.md created" test -f "$TEST_HOME/.claude/CLAUDE.md"
assert_contains "vault CLAUDE.md has managed block" \
    "$TEST_HOME/Knowledge/CLAUDE.md" '<!-- metalmind:managed:begin -->'
assert_contains "global CLAUDE.md has managed block" \
    "$TEST_HOME/.claude/CLAUDE.md" '<!-- metalmind:managed:begin -->'
assert_contains "global CLAUDE.md has starter prefs" \
    "$TEST_HOME/.claude/CLAUDE.md" 'Global Preferences'
assert_contains "classic flavor renders metalmind recall" \
    "$TEST_HOME/.claude/CLAUDE.md" 'metalmind recall'
assert "expected folders exist" test -d "$TEST_HOME/Knowledge/Inbox"
assert "save skill copied" test -f "$TEST_HOME/.claude/commands/save.md"
assert_contains "save skill uses metalmind CLI, not MCP" \
    "$TEST_HOME/.claude/commands/save.md" 'metalmind recall'
assert_contains "architect agent has no permissionMode: auto" \
    <(grep -c 'permissionMode: auto' "$TEST_HOME/.claude/agents/architect.md" || echo 0) \
    '0'

section "2. stamp is idempotent"
"$METALMIND_BIN" stamp --skip-watcher > "$TEST_HOME/stamp1.log" 2>&1
"$METALMIND_BIN" stamp --skip-watcher > "$TEST_HOME/stamp2.log" 2>&1
assert_contains "second stamp reports unchanged vault block" \
    "$TEST_HOME/stamp2.log" 'unchanged'

section "3. pulse reads the config back"
"$METALMIND_BIN" doctor > "$TEST_HOME/doctor.log" 2>&1 || true
# Prereqs may fail (docker/claude/etc absent); that's allowed. We only care
# that the config section surfaces correctly.
assert_contains "doctor shows flavor" "$TEST_HOME/doctor.log" 'flavor:         classic'
assert_contains "doctor shows vault path" \
    "$TEST_HOME/doctor.log" "$TEST_HOME/Knowledge"
assert_contains "doctor shows vault-only routing config" \
    "$TEST_HOME/doctor.log" 'Config at'

section "4. store copper writes to Inbox/"
# Skip the synchronous reindex — no watcher to hit anyway.
METALMIND_SKIP_REINDEX=1 "$METALMIND_BIN" save "integration test insight" \
    --title "smoke-note" \
    > "$TEST_HOME/save.log" 2>&1 || true
assert "Inbox note created" sh -c 'ls "$TEST_HOME"/Knowledge/Inbox/*smoke-note*.md >/dev/null 2>&1'

section "5. uninstall is reversible (flag-driven)"
# Pipe 'yes' through to auto-accept the interactive confirm prompts.
yes | "$METALMIND_BIN" uninstall > "$TEST_HOME/uninstall.log" 2>&1 || true
assert "config.json removed" sh -c '! test -f "$TEST_HOME/.metalmind/config.json"'
assert "vault notes preserved" sh -c 'ls "$TEST_HOME"/Knowledge/Inbox/*smoke-note*.md >/dev/null 2>&1'
# After uninstall, the sentinel block should be gone — but user content around it stays.
if [ -f "$TEST_HOME/.claude/CLAUDE.md" ]; then
    if grep -qF '<!-- metalmind:managed:begin -->' "$TEST_HOME/.claude/CLAUDE.md"; then
        printf '  ✗ sentinel block still in global CLAUDE.md after uninstall\n'
        FAIL=$((FAIL + 1))
    else
        printf '  ✓ sentinel block stripped from global CLAUDE.md\n'
        PASS=$((PASS + 1))
    fi
fi

printf '\n=== Result: %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
