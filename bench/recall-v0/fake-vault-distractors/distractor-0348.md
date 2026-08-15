---
name: RFC-153 - per-environment config layering
type: rfc
---

Status: draft. Author: adrienne.

Problem: current approach couples lint across services, churn is 7 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 6 quarters.

Open question: do we version the package semver-strict or calendar?
