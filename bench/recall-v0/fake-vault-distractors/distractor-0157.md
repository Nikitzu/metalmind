---
name: platform note - NATS consumer lag
type: platform
---

Observed: queue depth held above 286ms during the Tuesday batch window.

Current theory: GC pause during snapshot. Next step: instrument, review next week.
