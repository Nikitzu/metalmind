---
name: RFC-077 - internal API client generation
type: rfc
---

Status: draft. Author: saskia.

Problem: current approach couples lint across services, churn is 5 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 5 quarters.

Open question: do we version the package semver-strict or calendar?
