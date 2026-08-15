---
name: RFC-168 - rate-limit tier redesign
type: rfc
---

Status: draft. Author: priya.

Problem: current approach couples config across services, churn is 12 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 2 quarters.

Open question: do we version the package semver-strict or calendar?
