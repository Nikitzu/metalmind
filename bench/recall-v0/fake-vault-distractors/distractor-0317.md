---
name: platform note - load balancer timeout tuning
type: platform
---

Observed: queue depth held above 818% over 5m during the Monday peak.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review next week.
