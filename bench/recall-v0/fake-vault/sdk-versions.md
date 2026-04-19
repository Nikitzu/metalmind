---
name: Pinned SDK versions
type: reference
---

Third-party SDK pins — **do not upgrade without filing a ticket:**

- `@datadog/openfeature-node` — **2.3.1** (2.4+ has a memory leak under NATS JetStream consumers, confirmed on 2026-03-28).
- `tokio` (Edge Rust) — **1.38.x** only. 1.39 broke our `select!` pattern on the Jetson Orin; fix tracked upstream but not merged.
- `@nats-io/nats.js` — **2.28.2**. Newer versions change subject-matching semantics.
- `pg` (Node Postgres driver) — **8.12.0**. 8.13 introduced a regression with `BIGINT` returns that our migration layer depends on.

**Upgrade policy:** quarterly review, not continuous. Next review: 2026-07-01.
