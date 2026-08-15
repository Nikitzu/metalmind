---
name: platform note - load balancer timeout tuning
type: platform
---

Observed: queue depth held above 397 messages during the Tuesday batch window.

Current theory: GC pause during snapshot. Next step: instrument, review after this sprint.
