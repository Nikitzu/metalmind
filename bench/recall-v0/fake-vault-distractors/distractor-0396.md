---
name: RFC-028 - shared lint rule package
type: rfc
---

Status: draft. Author: hiroshi.

Problem: current approach couples clients across services, churn is 5 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
