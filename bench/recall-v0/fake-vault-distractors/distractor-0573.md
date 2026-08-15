---
name: platform note - GCS egress cost
type: platform
---

Observed: p95 spiked to 804ms during the Friday ramp-down.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review at the platform sync.
