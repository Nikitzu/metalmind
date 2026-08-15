---
name: CI note - artefact bloat Q3 2026
type: ci
---

lint-all duration crept from 5m to 22m over 2 weeks. Culprit: fixtures regenerated per-test. Fix landing January - tracked QF-944.
