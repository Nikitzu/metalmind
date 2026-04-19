---
name: Row-level security banned after QF-INC-41
type: decision
date: 2025-09-22
---

**Postgres RLS is banned from new code paths as of 2025-09-22.**

Root cause of incident **QF-INC-41** (2025-09-19): a misconfigured RLS policy on the `flight_plans` table silently dropped rows for the `operator` role during a migration. Fleet API returned empty lists to operators for **47 minutes** before anyone noticed. No data loss, but major trust damage.

**Rule:** authorization lives in application code (Fleet API middleware). DB roles are coarse-grained (`app_reader`, `app_writer`) — no per-tenant policies in Postgres.

**Exception process:** if you genuinely need RLS, file an ADR and get sign-off from Aria + Dmitri. As of 2026-04-01, zero exceptions granted.
