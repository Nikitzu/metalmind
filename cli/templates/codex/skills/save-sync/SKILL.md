---
name: save-sync
description: Use only when the user explicitly asks to both save and sync in one step, such as "save and push this", "save it and sync", or "/save-sync". For saving alone use the save skill; for syncing alone use the sync skill. Writes the note via metalmind scribe, then pushes the vault via metalmind sync.
metadata:
  short-description: Save a session insight, then push the vault.
---

Do these two things in order. Complete the save fully, including the user's approval of the draft, before starting the sync. If the user declines the save, stop and do not sync.

# Part 1: Save

{{> .shared/save-body.md}}

# Part 2: Sync

{{> .shared/sync-body.md}}
