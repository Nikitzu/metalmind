---
name: RFC-101 - rate-limit tier redesign
type: rfc
---

Status: draft. Author: renata.

Problem: current approach couples flags across services, churn is 5 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
