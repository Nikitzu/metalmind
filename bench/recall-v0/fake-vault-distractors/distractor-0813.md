---
name: platform note - NATS consumer lag
type: platform
---

Observed: error rate climbed past 177ms during the Monday peak.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review at the platform sync.
