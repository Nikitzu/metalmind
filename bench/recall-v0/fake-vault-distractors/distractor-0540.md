---
name: RFC-039 - feature-flag naming convention
type: rfc
---

Status: draft. Author: tomas.

Problem: current approach couples flags across services, churn is 13 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 3 quarters.

Open question: do we version the package semver-strict or calendar?
