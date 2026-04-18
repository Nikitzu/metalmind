# Agent Teams

Four slash commands spawn parallel Claude Code sessions ("teammates") that share a task list and message each other. One session acts as the lead; teammates work independently with their own context windows.

**Requires Claude Code v2.1.32+.** `claude --version` to check.

## What the installer does

- Sets `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `~/.claude/settings.json`
- Sets `teammateMode: "auto"` in `~/.claude.json`
- Copies four team commands into `~/.claude/commands/`

No external dependencies. Works out of the box in in-process mode.

## The four commands

| Command | Use when |
|---|---|
| `/team-debug <bug>` | Root cause isn't obvious — 3-5 adversaries form competing hypotheses, argue via `SendMessage`, converge on the theory with strongest evidence. |
| `/team-feature <feature>` | Feature touches backend + frontend + tests — architect plans, each layer owned by a different teammate. |
| `/team-multi-repo-audit <concern>` | Same pattern or concern across multiple repos — one reviewer per repo, in parallel, findings synthesized. |
| `/team-pr-review <pr>` | Deep PR review — security, api-contract, performance, conventions reviewers in parallel. |

## Display modes

Two modes — `teammateMode` in `~/.claude.json` controls which:

- **`"auto"`** (default in this stack) — split panes if already in a supported terminal, else in-process. Safe default.
- **`"in-process"`** — all teammates in your current terminal. Use `Shift+Down` to cycle, type to message directly, `Enter` to view a teammate's full session. Works everywhere.
- **`"tmux"`** — split-pane mode. Auto-detects whether to use iTerm2 or tmux. See [iTerm2 setup](#iterm2-split-panes-optional).

## iTerm2 split panes (optional)

If you want each teammate in its own iTerm2 pane instead of cycling via Shift+Down:

1. **Install `it2` CLI**:
   ```bash
   brew install mkusaka/tap/it2
   ```
   Or see the [it2 repo](https://github.com/mkusaka/it2) for alternatives.

2. **Enable the iTerm2 Python API**:
   iTerm2 → Settings → General → Magic → **Enable Python API**

3. **Set mode to `"tmux"`** in `~/.claude.json` (this is the split-pane mode name — it auto-detects iTerm2, despite the name):
   ```json
   { "teammateMode": "tmux" }
   ```

Each teammate now gets its own pane. Click into a pane to interact directly with that teammate.

## Using a team

After restart, trigger one of the commands with a target:

```
/team-debug BUG-123
/team-pr-review 142
/team-feature "add CSV export to the reports page"
/team-multi-repo-audit "find all usages of deprecated X helper"
```

The lead reads context, spawns teammates, and coordinates. Watch the shared task list (`Ctrl+T` in in-process mode).

## When NOT to use a team

- Sequential tasks with dependencies (one teammate blocks the next)
- Same-file edits (teammates overwrite each other)
- Routine work a single session can handle
- Short tasks where coordination overhead exceeds benefit

Token cost scales linearly with team size. 3 focused teammates usually outperform 5 scattered ones.

## Cleanup

Tell the lead: `Clean up the team`. This removes shared resources at `~/.claude/teams/<name>/` and `~/.claude/tasks/<name>/`. Shut teammates down first if any are still running.

## Known limitations

- No `/resume` or `/rewind` support for in-process teammates — a resumed lead may reference teammates that no longer exist
- One team per session at a time
- No nested teams (teammates can't spawn their own teammates)
- Permissions set at spawn time — all teammates inherit the lead's mode

## Disabling

If teams get in the way:

- Remove the `/team-*.md` commands from `~/.claude/commands/`
- Set `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0` in `~/.claude/settings.json`

Or leave everything in place and just don't invoke them — they're opt-in.

## References

- Official docs: <https://code.claude.com/docs/en/agent-teams>
- `it2` CLI: <https://github.com/mkusaka/it2>
