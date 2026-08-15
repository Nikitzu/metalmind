---
name: platform note - Redis memory ceiling
type: platform
---

Observed: p95 spiked to 327ms during the Tuesday batch window.

Current theory: GC pause during snapshot. Next step: instrument, review next week.
