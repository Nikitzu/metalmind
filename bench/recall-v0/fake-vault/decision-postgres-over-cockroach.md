---
name: Chose Postgres 16 over CockroachDB
type: decision
date: 2025-11-04
---

We evaluated CockroachDB vs Postgres 16 for the Dispatcher's primary store. **Picked Postgres 16.**

Reasons:

1. **Cost** — CockroachDB Dedicated quote was ~3.4× our Postgres bill at expected 2026 volume.
2. **Operator familiarity** — Dmitri has run Postgres in prod for a decade; zero CockroachDB experience on team.
3. **Geo-replication not needed yet** — all drones are European airspace through Q4 2026; multi-region write is 2027 problem.

**Revisit trigger:** if we onboard a US customer with >500 drones, re-open this decision. Until then, Postgres stays.

Rejected alternatives: Yugabyte (same as Cockroach concerns), Aurora (GCP-only policy).
