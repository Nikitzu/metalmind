# General Development Principles

> **Scope**: Universal coding standards that apply to all projects
> **Priority**: Always apply unless explicitly overridden by project-specific rules

## Code Quality

- Write clean, maintainable, and readable code
- Follow existing patterns and conventions in the codebase
- Prefer simplicity over cleverness
- When referencing framework APIs (e.g., server functions, validators), always verify the correct method name from actual source/types before generating code — do not guess API names
- **Source verification**: For unfamiliar or recently-changed APIs, check official docs before writing code — training data goes stale

## YAGNI

- Add only features and abstractions currently needed
- Optimize only with a baseline measurement proving the problem exists
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

- Default: no inline comments. Add only when code cannot be self-explanatory through naming/structure — explain WHY, not WHAT
- Verify task/migration status against codebase before updating plan files. Confirm by code inspection before marking complete
- Commit documentation files only with explicit user approval

## Simplicity

- Straightforward solutions over complex ones. Single-component over split/abstracted unless requested
- Helpers and abstractions only for multi-use operations
- Scope changes to what was asked — no bonus features, refactors, or "improvements"

## Architecture (JS / TS projects)

- Follow the **1 file – 1 instance rule** — each file exports only one instance (exception: props interfaces for components)
- Server and Client build separation should be taken into account
- Move separate functions (mapping, calculations, transformations) into helper functions
- Check whether logic, values, or structures can be moved to constants, enums, or types — if possible, they must be moved

## Sharing & Reuse (JS / TS projects)

- Helpers, enums, constants, and types must be shared if used in multiple places
- Shared items live in root-level folders: `helpers/`, `enums/`, `constants/`, `types/`
- If used in only one component, place close to that component

## Standards

- Avoid duplication and ensure clean separation of concerns

### JS / TS specifics
- Always use strict equality: `===` and `!==`
- Always use `pnpm` as the package manager unless explicitly told otherwise (or unless the project's lockfile says otherwise — `npm`/`yarn`/`bun` lockfiles override)

## Git & Version Control

- Commit messages describe the change, not the tool. No AI attribution footers, no "Co-Authored-By: Claude", no emoji signatures
- Verify current branch before making changes
- Use `gh` CLI for PRs, issues, and all GitHub operations. `git` + `gh` only — no wrappers

## Cleanup & Deprecation

- After migration/rename/removal: search entire codebase for leftover references (barrel exports, config, env vars, imports)
- Before removing code, understand why it exists (Chesterton's Fence) — ask if unclear
- Deprecation order: remove consumers first, then implementation

## Incremental Delivery

- Implement in thin vertical slices — each slice is one complete path through the stack, not a horizontal layer
- Each increment leaves the system in a working, testable state — never break green between slices
- Rough target: ~100 lines per increment. If a change touches more, look for a natural split point
- Commit after each passing slice, not after accumulating a batch

## Investigation Rules

- 10-minute cap on bug exploration, then propose a fix or ask for direction. Present 2-3 approaches ranked by likelihood
- Check existing plans before proposing solutions. State deviation and reasoning if contradicting a plan
- First fix failed → stop, document why, propose alternative. Same approach twice is a signal to change strategy
