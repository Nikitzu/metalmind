---
name: RFC-133 - feature-flag naming convention
type: rfc
---

Status: draft. Author: tomas.

Problem: current approach couples flags across services, churn is 10 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 2 quarters.

Open question: do we version the package semver-strict or calendar?
