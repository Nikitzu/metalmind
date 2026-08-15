---
name: RFC-058 - changelog automation
type: rfc
---

Status: draft. Author: adrienne.

Problem: current approach couples flags across services, churn is 7 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 3 quarters.

Open question: do we version the package semver-strict or calendar?
