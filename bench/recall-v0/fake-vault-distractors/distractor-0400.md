---
name: CI note - flaky test Q4 2026
type: ci
---

e2e-smoke duration crept from 9m to 21m over 3 weeks. Culprit: Docker layer bust on every run. Fix landing March - tracked QF-455.
