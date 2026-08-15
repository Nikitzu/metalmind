---
name: CI note - artefact bloat Q4 2026
type: ci
---

e2e-smoke duration crept from 9m to 15m over 3 weeks. Culprit: pnpm cache thrash. Fix landing January - tracked QF-979.
