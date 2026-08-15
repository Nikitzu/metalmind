---
name: CI note - cache miss Q3 2025
type: ci
---

lint-all duration crept from 8m to 17m over 7 weeks. Culprit: cross-compile hit after toolchain bump. Fix landing July - tracked QF-871.
