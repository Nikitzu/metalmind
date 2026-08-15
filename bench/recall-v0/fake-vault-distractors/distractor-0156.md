---
name: RFC-175 - feature-flag naming convention
type: rfc
---

Status: draft. Author: yelena.

Problem: current approach couples lint across services, churn is 9 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 2 quarters.

Open question: do we version the package semver-strict or calendar?
