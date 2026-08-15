---
name: RFC-060 - feature-flag naming convention
type: rfc
---

Status: draft. Author: jonas.

Problem: current approach couples clients across services, churn is 4 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
