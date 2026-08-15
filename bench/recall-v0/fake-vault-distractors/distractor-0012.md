---
name: RFC-114 - changelog automation
type: rfc
---

Status: draft. Author: cormac.

Problem: current approach couples config across services, churn is 12 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 6 quarters.

Open question: do we version the package semver-strict or calendar?
