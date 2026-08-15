---
name: RFC-156 - shared lint rule package
type: rfc
---

Status: draft. Author: tomas.

Problem: current approach couples config across services, churn is 14 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 6 quarters.

Open question: do we version the package semver-strict or calendar?
