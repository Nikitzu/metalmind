---
name: RFC-031 - rate-limit tier redesign
type: rfc
---

Status: draft. Author: hiroshi.

Problem: current approach couples flags across services, churn is 10 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 5 quarters.

Open question: do we version the package semver-strict or calendar?
