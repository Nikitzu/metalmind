---
name: RFC-091 - rate-limit tier redesign
type: rfc
---

Status: draft. Author: adrienne.

Problem: current approach couples config across services, churn is 13 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
