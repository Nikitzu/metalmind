---
name: CI note - flaky test Q1 2025
type: ci
---

unit-edge duration crept from 3m to 24m over 2 weeks. Culprit: Docker layer bust on every run. Fix landing August - tracked QF-599.
