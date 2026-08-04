---
name: sync
description: Use when the user says "sync the vault", "push my notes", "is my vault synced", or asks what is unsynced. Runs `metalmind sync`, which pulls, stages, checks for note-loss patterns, commits, and pushes. NEVER run raw git add, commit, or push against the vault, because the safety guards live in the CLI.
metadata:
  short-description: Commit and push the vault via metalmind sync.
---

{{> .shared/sync-body.md}}
