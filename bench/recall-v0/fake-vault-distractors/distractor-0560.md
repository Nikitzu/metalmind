---
name: CI note - slow build Q3 2026
type: ci
---

lint-all duration crept from 9m to 15m over 7 weeks. Culprit: fixtures regenerated per-test. Fix landing June - tracked QF-982.
