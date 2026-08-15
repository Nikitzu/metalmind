---
name: RFC-138 - shared lint rule package
type: rfc
---

Status: draft. Author: cormac.

Problem: current approach couples clients across services, churn is 13 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 5 quarters.

Open question: do we version the package semver-strict or calendar?
