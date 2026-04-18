# General Development Principles

> **Scope**: Universal coding standards that apply to all projects
> **Priority**: Always apply unless explicitly overridden by project-specific rules

## Code Quality

- Write clean, maintainable, and readable code
- Follow existing patterns and conventions in the codebase
- Prefer simplicity over cleverness
- When referencing framework APIs (e.g., server functions, validators), always verify the correct method name from actual source/types before generating code — do not guess API names
- **Source verification**: For unfamiliar or recently-changed APIs, check official docs (Context7/DeepWiki) before writing code — training data goes stale

## YAGNI (You Aren't Gonna Need It)

- Don't over-engineer solutions
- Only add features and abstractions that are currently needed
- Avoid premature optimization — and when optimizing, **measure first**: no perf work without a baseline measurement proving the problem exists
- Three similar lines are better than a premature abstraction

## Error Handling

- Let exceptions propagate naturally when you can't handle them
- Only catch exceptions you can meaningfully recover from
- Use specific exception types with clear, actionable messages
- Don't add defensive checks for scenarios that can't happen

## Testing

- Write tests for important logic and edge cases
- Test behavior, not implementation details
- Use descriptive test names that explain what's being tested

## Documentation

- **CRITICAL: Never add inline comments unless extremely needed**
- Only add comments when code cannot be made self-explanatory through better naming or structure
- When comments are needed, explain WHY, not WHAT (the code shows what)
- Avoid obvious comments that restate the code
- When updating documentation or plan files, verify task/migration status against the actual codebase state before writing
- Do not mark items as complete unless confirmed by code inspection
- Never commit documentation files without explicit user approval

## Simplicity

- Prefer straightforward solutions over complex ones
- Don't create helpers or abstractions for one-time operations
- Don't add features, refactors, or "improvements" beyond what was asked
- Only add error handling, validation, and edge cases that are actually needed
- Prefer simple, single-component solutions over split/abstracted designs unless explicitly requested

## Architecture

- Follow the **1 file – 1 instance rule** — each file exports only one instance (exception: props interfaces for components)
- Server and Client build separation should be taken into account
- Move separate functions (mapping, calculations, transformations) into helper functions
- Check whether logic, values, or structures can be moved to constants, enums, or types — if possible, they must be moved

## Sharing & Reuse

- Helpers, enums, constants, and types must be shared if used in multiple places
- Shared items live in root-level folders: `helpers/`, `enums/`, `constants/`, `types/`
- If used in only one component, place close to that component

## Standards

- Always use strict equality: `===` and `!==`
- Always use `pnpm` as the package manager unless explicitly told otherwise
- Avoid duplication and ensure clean separation of concerns

## Git & Version Control

- **CRITICAL: Never add AI attribution footers to commit messages**
- Never add "Co-Authored-By: Claude" or similar AI mentions
- Never add footers like "Generated with Claude Code" or emoji signatures
- Commit messages should describe the changes, not the tool used
- Before making changes, always verify which git branch is currently checked out
- Never attempt to commit files that are in `.gitignore`
- Use `gh` CLI for PRs, issues, and all GitHub operations

## Session Workflow

- **Front-load context**: Before any non-trivial task, read plan files from `~/Documents/plans/<current-project>/`. Summarize understanding. Stay consistent with existing plans. Skip only if user explicitly asks.
- **Never use parallel memory_observation agents** — they produce documentation, not code
- **End-of-session memory**: Use `/save` to persist key decisions, discoveries, and context into the Obsidian vault at `~/Knowledge/`. Recall via `search_vault`. Do not write to legacy `MEMORY.md` files — that system is retired.

## Cleanup & Deprecation

- After any migration, renaming, or removal, search the entire codebase for leftover references using Grep and Glob
- Check: barrel exports, UI placeholder text, config files, environment variables, import paths
- Before removing code, understand why it exists (Chesterton's Fence) — if unclear, ask before deleting
- When deprecating: remove all consumers first, then the implementation — never leave dead exports or zombie imports

## Incremental Delivery

- Implement in thin vertical slices — each slice is one complete path through the stack, not a horizontal layer
- Each increment leaves the system in a working, testable state — never break green between slices
- Rough target: ~100 lines per increment. If a change touches more, look for a natural split point
- Commit after each passing slice, not after accumulating a batch

## Investigation Rules

- Limit bug exploration to 10 minutes before proposing a concrete fix or asking for direction. Do not re-read the same files repeatedly. If stuck, present 2-3 approaches ranked by likelihood.
- Always check existing plan documents before proposing solutions. Never contradict plans without stating the deviation and reasoning.
- When a first fix attempt fails, do not continue with the same approach. Pause, document why it failed, propose an alternative strategy.
