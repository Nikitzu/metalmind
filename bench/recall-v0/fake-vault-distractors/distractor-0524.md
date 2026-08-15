---
name: RFC-062 - rate-limit tier redesign
type: rfc
---

Status: draft. Author: luca.

Problem: current approach couples lint across services, churn is 7 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
