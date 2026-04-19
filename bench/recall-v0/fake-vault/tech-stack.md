---
name: Quillfly tech stack
type: reference
---

Core services:

- **Dispatcher** — Go 1.23, stateless, scales horizontally behind GCLB.
- **Edge controller** — Rust (tokio), runs on each drone's onboard Jetson Orin Nano.
- **Fleet API** — Node 20 + Fastify, serves the operator console.
- **Console UI** — React 19 + Vite 6, deployed to Cloudflare Pages.

Data plane:

- **Postgres 16** primary DB (single writer, 2 read replicas, all in `europe-west4`).
- **NATS JetStream** for inter-service messaging (chosen over Kafka — simpler ops at our scale).
- **Redis 7.2** for session + rate-limit state.

**Why Node 20 specifically:** pinned because `@datadog/openfeature-node@2.x` requires Node ≥ 20.11. We do **not** upgrade to Node 22 until Datadog ships official support — currently tracked as issue QF-212.
