---
name: RFC-117 - per-environment config layering
type: rfc
---

Status: draft. Author: cormac.

Problem: current approach couples clients across services, churn is 3 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 2 quarters.

Open question: do we version the package semver-strict or calendar?
