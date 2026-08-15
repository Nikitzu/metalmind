---
name: platform note - load balancer timeout tuning
type: platform
---

Observed: error rate climbed past 271% over 5m during the Tuesday batch window.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review after this sprint.
