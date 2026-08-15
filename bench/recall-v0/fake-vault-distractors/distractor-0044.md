---
name: RFC-123 - internal API client generation
type: rfc
---

Status: draft. Author: saskia.

Problem: current approach couples lint across services, churn is 13 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 4 quarters.

Open question: do we version the package semver-strict or calendar?
