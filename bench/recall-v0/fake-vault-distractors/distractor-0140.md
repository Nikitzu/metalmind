---
name: RFC-070 - internal API client generation
type: rfc
---

Status: draft. Author: yelena.

Problem: current approach couples config across services, churn is 15 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 5 quarters.

Open question: do we version the package semver-strict or calendar?
