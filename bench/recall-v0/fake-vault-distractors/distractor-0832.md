---
name: CI note - flaky test Q3 2026
type: ci
---

e2e-smoke duration crept from 7m to 17m over 5 weeks. Culprit: Docker layer bust on every run. Fix landing July - tracked QF-655.
