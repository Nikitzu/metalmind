---
name: RFC-026 - changelog automation
type: rfc
---

Status: draft. Author: dmitri.

Problem: current approach couples clients across services, churn is 9 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
