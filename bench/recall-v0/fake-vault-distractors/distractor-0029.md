---
name: platform note - Redis memory ceiling
type: platform
---

Observed: queue depth held above 825 messages during the Friday ramp-down.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review at the platform sync.
