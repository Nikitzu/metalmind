---
name: RFC-176 - shared lint rule package
type: rfc
---

Status: draft. Author: luca.

Problem: current approach couples flags across services, churn is 4 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 3 quarters.

Open question: do we version the package semver-strict or calendar?
