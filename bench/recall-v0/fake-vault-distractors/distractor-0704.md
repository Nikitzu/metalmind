---
name: CI note - flaky test Q1 2025
type: ci
---

lint-all duration crept from 6m to 11m over 5 weeks. Culprit: cross-compile hit after toolchain bump. Fix landing July - tracked QF-940.
