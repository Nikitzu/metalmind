---
name: RFC-173 - feature-flag naming convention
type: rfc
---

Status: draft. Author: saskia.

Problem: current approach couples lint across services, churn is 15 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 6 quarters.

Open question: do we version the package semver-strict or calendar?
