# General Development Principles

> **Scope**: Universal coding standards that apply to all projects
> **Priority**: Always apply unless explicitly overridden by project-specific rules

## YAGNI

- Add only features and abstractions currently needed
- Optimize only with a baseline measurement proving the problem exists
- Three similar lines are better than a premature abstraction

## Error Handling

- Let exceptions propagate naturally when you can't handle them
- Only catch exceptions you can meaningfully recover from
- Use specific exception types with clear, actionable messages
- Don't add defensive checks for scenarios that can't happen

## Git & Version Control

- Commit messages describe the change, not the tool. No AI attribution footers, no "Co-Authored-By: Claude", no emoji signatures
- Verify current branch before making changes
- Use `gh` CLI for PRs, issues, and all GitHub operations. `git` + `gh` only - no wrappers

## Cleanup & Deprecation

- After migration/rename/removal: search entire codebase for leftover references (barrel exports, config, env vars, imports)
- Before removing code, understand why it exists (Chesterton's Fence) - ask if unclear
- Deprecation order: remove consumers first, then implementation

## Incremental Delivery

- Implement in thin vertical slices - each slice is one complete path through the stack, not a horizontal layer
- Each increment leaves the system in a working, testable state - never break green between slices
- Rough target: ~100 lines per increment. If a change touches more, look for a natural split point
- Commit after each passing slice, not after accumulating a batch

## Investigation Rules

- 10-minute cap on bug exploration, then propose a fix or ask for direction. Present 2-3 approaches ranked by likelihood
- Check existing plans before proposing solutions. State deviation and reasoning if contradicting a plan
- First fix failed → stop, document why, propose alternative. Same approach twice is a signal to change strategy
