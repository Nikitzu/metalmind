---
name: platform note - Redis memory ceiling
type: platform
---

Observed: p95 spiked to 520ms during the Tuesday batch window.

Current theory: GC pause during snapshot. Next step: instrument, review after this sprint.
