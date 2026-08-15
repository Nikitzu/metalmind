---
name: CI note - slow build Q1 2025
type: ci
---

lint-all duration crept from 9m to 16m over 8 weeks. Culprit: pnpm cache thrash. Fix landing October - tracked QF-910.
