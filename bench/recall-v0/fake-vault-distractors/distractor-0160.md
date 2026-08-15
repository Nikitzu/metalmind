---
name: CI note - cache miss Q1 2026
type: ci
---

lint-all duration crept from 7m to 12m over 4 weeks. Culprit: pnpm cache thrash. Fix landing November - tracked QF-458.
