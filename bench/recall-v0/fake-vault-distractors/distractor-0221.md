---
name: platform note - NATS consumer lag
type: platform
---

Observed: p95 spiked to 837% over 5m during the Friday ramp-down.

Current theory: GC pause during snapshot. Next step: instrument, review at the platform sync.
