---
name: RFC-131 - internal API client generation
type: rfc
---

Status: draft. Author: jonas.

Problem: current approach couples lint across services, churn is 4 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 2 quarters.

Open question: do we version the package semver-strict or calendar?
