---
name: RFC-073 - feature-flag naming convention
type: rfc
---

Status: draft. Author: hiroshi.

Problem: current approach couples lint across services, churn is 4 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 3 quarters.

Open question: do we version the package semver-strict or calendar?
