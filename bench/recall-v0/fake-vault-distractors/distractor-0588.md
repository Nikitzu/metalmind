---
name: RFC-047 - changelog automation
type: rfc
---

Status: draft. Author: renata.

Problem: current approach couples lint across services, churn is 8 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 5 quarters.

Open question: do we version the package semver-strict or calendar?
