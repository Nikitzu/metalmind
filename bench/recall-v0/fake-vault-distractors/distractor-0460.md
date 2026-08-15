---
name: RFC-043 - feature-flag naming convention
type: rfc
---

Status: draft. Author: priya.

Problem: current approach couples config across services, churn is 14 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 3 quarters.

Open question: do we version the package semver-strict or calendar?
