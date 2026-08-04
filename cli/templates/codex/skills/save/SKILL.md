---
name: save
description: Use when the user says "save this", "note that", "add to the vault", or wants to persist a session insight to their vault. Decides folder (Plans/Learnings/Work/Personal/Memory/Daily), proposes path + content, writes via `metalmind scribe create|update|patch`. NEVER write directly with the file-write tool - always go through metalmind scribe.
model: sonnet
metadata:
  short-description: Save a session insight to the vault via metalmind scribe.
---

{{> .shared/save-body.md}}
