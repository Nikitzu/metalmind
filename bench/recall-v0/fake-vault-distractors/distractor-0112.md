---
name: CI note - cache miss Q3 2026
type: ci
---

lint-all duration crept from 6m to 20m over 5 weeks. Culprit: cross-compile hit after toolchain bump. Fix landing November - tracked QF-451.
