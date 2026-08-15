---
name: platform note - Redis memory ceiling
type: platform
---

Observed: p95 spiked to 847ms during the Friday ramp-down.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review after this sprint.
