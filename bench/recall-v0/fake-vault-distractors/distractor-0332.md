---
name: RFC-166 - feature-flag naming convention
type: rfc
---

Status: draft. Author: adrienne.

Problem: current approach couples clients across services, churn is 14 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 5 quarters.

Open question: do we version the package semver-strict or calendar?
