---
name: CI note - flaky test Q2 2025
type: ci
---

lint-all duration crept from 6m to 17m over 4 weeks. Culprit: Docker layer bust on every run. Fix landing June - tracked QF-460.
