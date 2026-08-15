---
name: platform note - Redis memory ceiling
type: platform
---

Observed: p95 spiked to 891% over 5m during the Monday peak.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review next week.
