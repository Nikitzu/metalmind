---
name: platform note - GCS egress cost
type: platform
---

Observed: queue depth held above 427ms during the Tuesday batch window.

Current theory: TLS handshake cost from new region. Next step: instrument, review at the platform sync.
