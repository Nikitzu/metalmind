---
name: RFC-021 - feature-flag naming convention
type: rfc
---

Status: draft. Author: renata.

Problem: current approach couples config across services, churn is 7 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
