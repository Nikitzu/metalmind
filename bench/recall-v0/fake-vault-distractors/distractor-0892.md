---
name: RFC-064 - internal API client generation
type: rfc
---

Status: draft. Author: luca.

Problem: current approach couples config across services, churn is 9 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
