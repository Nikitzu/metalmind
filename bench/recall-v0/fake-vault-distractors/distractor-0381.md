---
name: platform note - GCS egress cost
type: platform
---

Observed: queue depth held above 652ms during the Tuesday batch window.

Current theory: GC pause during snapshot. Next step: instrument, review at the platform sync.
