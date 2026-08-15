---
name: CI note - slow build Q4 2025
type: ci
---

e2e-smoke duration crept from 5m to 18m over 6 weeks. Culprit: cross-compile hit after toolchain bump. Fix landing July - tracked QF-475.
