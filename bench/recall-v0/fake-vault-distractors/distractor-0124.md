---
name: RFC-140 - shared lint rule package
type: rfc
---

Status: draft. Author: priya.

Problem: current approach couples config across services, churn is 5 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 5 quarters.

Open question: do we version the package semver-strict or calendar?
