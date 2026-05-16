---
name: metalmind-recall
description: Recall prior decisions, architecture notes, and context from the metalmind knowledge vault. Use before any non-trivial task — architecture, design, debugging, planning — to check what was already decided. Do not use for trivial one-line edits or pure syntax lookups.
---

# metalmind recall

Before starting a non-trivial task, recall relevant prior context from the vault:

```bash
{{RECALL_CMD}} "<query>"
```

- Add `--deep` for related notes, `--expand` for linked context.
- Rephrase the query 2-3× if the first attempt misses — the vault may use
  different wording.
- Skip recall for trivial one-off edits and pure syntax lookups.

To write to the vault, use `metalmind scribe <create|update|patch>` — never raw
file writes.
