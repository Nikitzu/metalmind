---
name: RFC-170 - per-environment config layering
type: rfc
---

Status: draft. Author: adrienne.

Problem: current approach couples config across services, churn is 4 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
