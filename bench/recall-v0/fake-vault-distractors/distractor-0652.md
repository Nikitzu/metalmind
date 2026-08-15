---
name: RFC-012 - shared lint rule package
type: rfc
---

Status: draft. Author: jonas.

Problem: current approach couples clients across services, churn is 7 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
