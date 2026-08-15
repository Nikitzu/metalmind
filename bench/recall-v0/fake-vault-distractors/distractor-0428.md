---
name: RFC-149 - changelog automation
type: rfc
---

Status: draft. Author: renata.

Problem: current approach couples clients across services, churn is 4 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 2 quarters.

Open question: do we version the package semver-strict or calendar?
