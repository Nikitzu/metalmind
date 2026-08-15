---
name: RFC-010 - feature-flag naming convention
type: rfc
---

Status: draft. Author: renata.

Problem: current approach couples clients across services, churn is 6 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 6 quarters.

Open question: do we version the package semver-strict or calendar?
