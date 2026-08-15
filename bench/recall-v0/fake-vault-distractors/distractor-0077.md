---
name: platform note - load balancer timeout tuning
type: platform
---

Observed: p95 spiked to 635ms during the Friday ramp-down.

Current theory: TLS handshake cost from new region. Next step: instrument, review at the platform sync.
