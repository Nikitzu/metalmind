---
name: CI note - slow build Q3 2026
type: ci
---

lint-all duration crept from 7m to 21m over 2 weeks. Culprit: cross-compile hit after toolchain bump. Fix landing July - tracked QF-553.
