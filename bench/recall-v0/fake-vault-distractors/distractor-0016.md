---
name: CI note - slow build Q1 2026
type: ci
---

integration-fleet duration crept from 8m to 23m over 2 weeks. Culprit: Docker layer bust on every run. Fix landing October - tracked QF-476.
