---
name: using-teams
description: "Spawning, coordinating, and debugging multi-agent teams. MUST be invoked BEFORE any TeamCreate call, BEFORE invoking /team-feature, /team-debug, /team-pr-review, /team-multi-repo-audit, or any other team-* skill, and AS SOON AS a teammate idle_notification arrives without readable message content. Also invoke when the user mentions 'team', 'spawn agents', 'agents in parallel', 'team_name', 'split-screen agents', 'iTerm panes for agents', when troubleshooting a stuck/silent teammate, when planning to TeamDelete a team, or when explaining the team-feature flow to the user. Covers the team_name+name spawn discipline, the idle≠silence rule, the SendMessage-vs-text rule, the TaskList-as-canonical-handoff rule, the architect-first spawn order, and the lifecycle/manual-nuke override. Use this skill anytime any aspect of multi-agent coordination touches the conversation."
---

# Using Teams

Hard rules for spawning and coordinating multi-agent teams via `TeamCreate` + `Agent` and the `/team-*` skills (`/team-feature`, `/team-debug`, `/team-pr-review`, `/team-multi-repo-audit`).

If any rule below is violated, **stop, name the violation, and restart cleanly.** Don't paper over.

## Spawning — non-negotiable

1. **`TeamCreate` first.** Every team starts with `TeamCreate { team_name, agent_type, description }`. No teammate spawns before the team exists.
2. **`team_name` AND `name` on EVERY teammate spawn.** Without `team_name`, the `Agent` call creates a normal subagent that does NOT join the team and does NOT appear in the user's split-pane / pane / tab UI. **This is the #1 silent failure mode** — the spawn looks successful, but the user sees nothing in their team UI. Always pass both.
3. **`name` is the addressable handle.** Use it for `SendMessage to:` and for `owner` in `TaskUpdate`. Never use the `agentId` UUID for either.
4. **Don't double-spawn the same role.** Read `~/.claude/teams/<team>/config.json` before adding another teammate with the same `name`.

## Communication — never assume silence

When a teammate goes idle, the `idle_notification` is often the ONLY thing that renders in the lead's context — the teammate's actual `SendMessage` content can fail to surface as readable text in the lead's conversation. **Idle ≠ silence.**

When a teammate goes idle:

1. Do NOT respond based on the idle notification alone.
2. **Check before pinging:**
   - `TaskList` — did they create or update tasks?
   - The expected output file (plan path, code change, test file) — does it exist on disk?
   - `~/.claude/teams/<team>/` — config + any mailbox/inbox files the runtime exposes
3. Only after confirming the teammate produced nothing AND sent nothing should you re-ping. Otherwise act on what they actually delivered.
4. If the user's UI clearly shows content the lead's context does not, **say so and ask the user what they see.** The asymmetry between lead context and user split-pane view is real; surface it instead of guessing.

## Tools each teammate role MUST whitelist

Every agent role file (`~/.claude/agents/<role>.md`) MUST include these tools in its `tools:` frontmatter, or the runtime will reject the call with "command absence":

- `SendMessage` — talk to lead and peers
- `TaskCreate` — seed work items
- `TaskUpdate` — claim, progress, complete
- `TaskList`, `TaskGet` — discover and inspect tasks

If a teammate goes silent, **first check whether SendMessage is in its `tools:` field.** Without it, the agent tries to call SendMessage, gets denied, and the rejection never surfaces to the lead — only `idle_notification` arrives. This was the silent failure on Apr 28 with CLI 2.1.121: older CLIs auto-granted these tools to teammates, the new CLI requires them in the whitelist, and the bundled role definitions weren't updated.

## Communication — text vs SendMessage

- **Lead-direction:** plain text output is invisible to teammates. To talk to a teammate you MUST call `SendMessage`.
- **Teammate-direction (CRITICAL):** prose a teammate writes in its own conversation is rendered ONLY in its iTerm pane — it is NOT delivered to the lead. Teammates MUST call `SendMessage` to communicate with the lead. Status updates, plan handoffs, task-completion notices, blockers, and questions all require an explicit `SendMessage` call. If a teammate does not call `SendMessage`, the lead receives nothing.
  - This is the single most common silent failure with the post-2.1.119 Claude Code CLI. Older versions may have auto-relayed teammate prose; the current CLI does not.
  - When a teammate's pane shows content but the lead's inbox/conversation has no `SendMessage` from them, that's the gap. Read `~/.claude/teams/<team>/inboxes/team-lead.json` and confirm whether any messages have `text` that is NOT a `permission_request` or `idle_notification` — if not, the teammate is communicating in the wrong channel.
  - Fix: every agent role definition under `~/.claude/agents/*.md` includes a hard rule at the top of its "Interaction rules (when running as a teammate)" section requiring `SendMessage`. Spawn prompts should reinforce it.
- To talk to the user, plain text is fine — never use `SendMessage` to address the user.
- Don't quote a teammate's prior message back at them when relaying — it's already rendered to the user.
- Don't send structured JSON status messages (`{"type":"idle"...}`, `{"type":"task_completed"...}`). Use plain text + `TaskUpdate`.

## Permission requests from teammates

When a teammate's tool call requires permission (Edit outside its allowed paths, Bash, Read of vault paths the agent doesn't have rules for, etc.), it sends a `permission_request` to the lead's inbox. These accumulate and **block the teammate** until approved.

- The approval prompt surfaces in the **user's** session UI, not the lead's `SendMessage` schema (no `permission_response` payload exists for the lead to send programmatically).
- If teammates appear stuck idle, dump the inbox: `cat ~/.claude/teams/<team>/inboxes/team-lead.json | python3 -c "import json,sys; [print(m['timestamp'], 'PERM' if 'permission_request' in m['text'] else 'IDLE' if 'idle_notification' in m['text'] else 'CONTENT') for m in json.load(sys.stdin)]"`. A wall of `PERM` entries means the teammate is blocked.
- Mitigation: ahead of time, grant the teammate the `addDirectories` / `addRules` permissions it will need (the suggestions are embedded in each `permission_request`'s payload), or pre-approve directory access at session scope.

## Task list — the canonical handoff

- Work assignment goes through `TaskCreate` + `TaskUpdate { owner }`, **not** through inline instructions in `SendMessage`.
- Each task ID maps to one commit / one logical unit of work.
- Use `addBlockedBy` to encode the dependency DAG.
- Mark tasks `completed` immediately when done — don't batch.

## Spawn order for `/team-feature`

```
architect (plan-only, read-only constraint)
  → wait for plan + lead approval
    → engineers in parallel (one per layer, disjoint file ownership)
      → qa-engineer
        → optional: conventions-reviewer / security-reviewer
```

- Architect always spawns first and produces the plan + seeds the task list.
- Architect must be told the read-only-until-approval constraint as a **prompt-level** instruction (its `permissionMode` may not propagate reliably to teammates).
- Engineers spawn only after the plan is approved and tasks are seeded with owners.
- Never spawn engineers in parallel without disjoint file sets — overlapping ownership causes write races.

## Lifecycle

- Never call `TeamDelete` until the user explicitly says "cleanup team" (or equivalent).
- If the user wants to nuke a stuck team:
  1. Send `shutdown_request` to each member first.
  2. If a member's process is dead but the registry still tracks it (`TeamDelete` fails with "active member"), the manual override is `rm -rf ~/.claude/teams/<team>/ ~/.claude/tasks/<team>/`.
  3. Verify with `ls ~/.claude/teams/`.

## When something looks wrong

- **A teammate's pane shows a stack trace from `/$bunfs/root/src/entrypoints/cli.js`** — that's a Claude Code CLI crash, not the agent's fault. Tell the user, suggest an issue at https://github.com/anthropics/claude-code/issues. Don't try to work around it by editing the agent's prompt.
- **A teammate keeps going idle without producing output the lead can see** — see "never assume silence" above. Almost always the teammate IS working; the lead's context just isn't seeing the SendMessage content.
- **The user's UI shows content the lead doesn't have** — expected. Ask them what they see; don't fabricate.

## Self-invocation

The user can invoke this skill manually with `/using-teams` to refresh their own memory of the rules, or to hand it as a brief to a fresh session. Treat manual invocation the same as auto-trigger.
