---
name: RFC-081 - internal API client generation
type: rfc
---

Status: draft. Author: yelena.

Problem: current approach couples flags across services, churn is 9 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 6 quarters.

Open question: do we version the package semver-strict or calendar?
