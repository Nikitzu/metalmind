---
name: platform note - NATS consumer lag
type: platform
---

Observed: queue depth held above 40ms during the Friday ramp-down.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review at the platform sync.
