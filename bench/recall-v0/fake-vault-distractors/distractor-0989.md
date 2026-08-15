---
name: platform note - NATS consumer lag
type: platform
---

Observed: queue depth held above 232ms during the Friday ramp-down.

Current theory: GC pause during snapshot. Next step: instrument, review at the platform sync.
