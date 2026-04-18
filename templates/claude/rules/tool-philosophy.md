# Tool Usage Philosophy

> **Scope**: Applies to all Claude Code sessions across all projects
> **Priority**: Always apply unless explicitly overridden by project-specific rules

## Core Principle

**Efficiency over automation.** The best tool completes the task with minimal overhead. Sometimes that's a skill, sometimes it's just reading a file and making a change.

## Skills

**Use when:** Task matches a skill's purpose, complex multi-step work needs structure, or user requests by name.

**Skip when:** Task is straightforward, direct action is faster, you don't need scaffolding.

| User says... | Use skill... |
|--------------|--------------|
| "check the code quality" | code review |
| "make sure tests pass" | verification |
| "help me plan this" | brainstorming / writing-plans |
| "debug this" | systematic-debugging |

## MCP Servers

Use contextually: documentation lookup for unfamiliar APIs, infrastructure interaction for cloud work, security analysis when adding dependencies. See CLAUDE.md for specific tool table.

## Plugins

Follow plugin principles during normal work even when not explicitly invoking them:

- **Code simplification** — always write clear, maintainable code
- **Security guidance** — proactively apply security best practices

## Agents

- **CRITICAL: Never spawn sub-agents (Agent tool) without explicit user permission or request**
- Always ask before dispatching parallel agents, background agents, or any sub-agent work
- The user decides when and how agents are used, not Claude

## Workflow

1. Understand the request — what is the user really asking?
2. Choose the right tool(s) — skill, MCP, direct action, plugin, or a combination. Multiple tools can and should be used together when the task calls for it.
3. Execute efficiently — simplest effective approach
4. Verify completion — did it work?
