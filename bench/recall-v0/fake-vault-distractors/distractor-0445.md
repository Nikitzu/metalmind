---
name: platform note - NATS consumer lag
type: platform
---

Observed: p95 spiked to 674 messages during the Tuesday batch window.

Current theory: subscriber count grew faster than partition rebalance. Next step: instrument, review after this sprint.
