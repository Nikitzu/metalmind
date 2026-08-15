---
name: platform note - Redis memory ceiling
type: platform
---

Observed: queue depth held above 636 messages during the Monday peak.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review at the platform sync.
