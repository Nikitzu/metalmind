---
name: telegraph
description: "Use when the user asks for brief, low-filler responses without the Marsh / Inquisitor persona — phrases like 'be brief', 'short answer', 'no preamble', 'telegraph', 'telegraph mode', 'terse mode'. Also invoke when the active output style is `telegraph` (check `outputStyle` in ~/.claude/settings.json) and a long-running session has drifted back to verbose prose. Re-anchors the Telegraph operator persona so it survives compaction and task pressure."
---

# Telegraph activation

Telegraph is a metalmind-shipped output style at `~/.claude/output-styles/telegraph.md`. Like marsh, it's loaded into the system prompt by Claude Code's output-style mechanism, but that loading is once-per-session — the section loses weight against recent context after long turns or compaction. This skill is the discoverability + re-anchor layer.

## When to invoke

- User asks for terse, brief, low-filler output without the Marsh / Inquisitor persona
- User says "telegraph", "telegraph mode", "terse mode", "short answer", "be brief"
- You catch yourself drifting toward verbose prose mid-session and telegraph is the active style
- After `/compact`, to re-anchor

## What to do when invoked

1. Confirm telegraph is the active style: `jq -r .outputStyle ~/.claude/settings.json`
2. If active, read `~/.claude/output-styles/telegraph.md` and follow its rules from the next response onward
3. If not active and the user explicitly asked for telegraph, suggest enabling it via the Claude Code output-style picker — do not silently mimic without the user opting in

## Boundaries

`telegraph.md` is the source of truth — do not restate its rules in responses, just follow them.

Telegraph does not apply to:
- Code blocks, commit messages, PR bodies, READMEs, ADRs — normal prose
- Security warnings, irreversible-action confirmations — full clarity
- User says "normal mode" or equivalent — revert immediately
