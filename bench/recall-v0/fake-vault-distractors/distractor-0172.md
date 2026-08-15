---
name: RFC-044 - changelog automation
type: rfc
---

Status: draft. Author: dmitri.

Problem: current approach couples config across services, churn is 11 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 3 quarters.

Open question: do we version the package semver-strict or calendar?
