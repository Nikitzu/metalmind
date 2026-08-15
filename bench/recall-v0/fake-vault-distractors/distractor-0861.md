---
name: platform note - Redis memory ceiling
type: platform
---

Observed: error rate climbed past 469 messages during the Tuesday batch window.

Current theory: GC pause during snapshot. Next step: instrument, review at the platform sync.
