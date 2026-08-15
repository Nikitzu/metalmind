---
name: CI note - slow build Q1 2026
type: ci
---

e2e-smoke duration crept from 6m to 22m over 4 weeks. Culprit: cross-compile hit after toolchain bump. Fix landing December - tracked QF-822.
