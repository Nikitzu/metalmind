---
name: platform note - Redis memory ceiling
type: platform
---

Observed: queue depth held above 62 messages during the Tuesday batch window.

Current theory: TLS handshake cost from new region. Next step: instrument, review after this sprint.
