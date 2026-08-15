---
name: RFC-094 - per-environment config layering
type: rfc
---

Status: draft. Author: maria.

Problem: current approach couples clients across services, churn is 4 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 5 quarters.

Open question: do we version the package semver-strict or calendar?
