---
name: platform note - NATS consumer lag
type: platform
---

Observed: p95 spiked to 336 messages during the Friday ramp-down.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review at the platform sync.
