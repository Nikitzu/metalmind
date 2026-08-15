---
name: platform note - GCS egress cost
type: platform
---

Observed: p95 spiked to 230ms during the Tuesday batch window.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review at the platform sync.
