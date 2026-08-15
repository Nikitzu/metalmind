---
name: RFC-162 - rate-limit tier redesign
type: rfc
---

Status: draft. Author: tomas.

Problem: current approach couples clients across services, churn is 12 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 3 quarters.

Open question: do we version the package semver-strict or calendar?
