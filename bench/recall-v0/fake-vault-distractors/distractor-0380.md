---
name: RFC-104 - rate-limit tier redesign
type: rfc
---

Status: draft. Author: saskia.

Problem: current approach couples flags across services, churn is 14 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 3 quarters.

Open question: do we version the package semver-strict or calendar?
