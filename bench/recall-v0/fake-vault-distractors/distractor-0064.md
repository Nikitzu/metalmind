---
name: CI note - artefact bloat Q2 2026
type: ci
---

lint-all duration crept from 6m to 24m over 3 weeks. Culprit: pnpm cache thrash. Fix landing July - tracked QF-798.
