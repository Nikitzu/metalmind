---
name: platform note - Redis memory ceiling
type: platform
---

Observed: queue depth held above 194% over 5m during the Tuesday batch window.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review at the platform sync.
