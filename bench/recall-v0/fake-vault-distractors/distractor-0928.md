---
name: CI note - artefact bloat Q4 2025
type: ci
---

e2e-smoke duration crept from 6m to 15m over 8 weeks. Culprit: Docker layer bust on every run. Fix landing May - tracked QF-802.
