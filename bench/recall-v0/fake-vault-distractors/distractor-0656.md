---
name: CI note - slow build Q4 2026
type: ci
---

e2e-smoke duration crept from 6m to 20m over 8 weeks. Culprit: Docker layer bust on every run. Fix landing April - tracked QF-460.
