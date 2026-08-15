---
name: RFC-147 - shared lint rule package
type: rfc
---

Status: draft. Author: priya.

Problem: current approach couples lint across services, churn is 15 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 3 quarters.

Open question: do we version the package semver-strict or calendar?
