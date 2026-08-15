---
name: CI note - flaky test Q4 2025
type: ci
---

e2e-smoke duration crept from 8m to 17m over 6 weeks. Culprit: Docker layer bust on every run. Fix landing February - tracked QF-986.
