---
name: RFC-127 - rate-limit tier redesign
type: rfc
---

Status: draft. Author: priya.

Problem: current approach couples lint across services, churn is 10 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 2 quarters.

Open question: do we version the package semver-strict or calendar?
