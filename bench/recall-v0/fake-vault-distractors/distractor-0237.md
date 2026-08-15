---
name: platform note - Redis memory ceiling
type: platform
---

Observed: p95 spiked to 850% over 5m during the Monday peak.

Current theory: GC pause during snapshot. Next step: instrument, review after this sprint.
