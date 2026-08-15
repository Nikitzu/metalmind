---
name: RFC-172 - internal API client generation
type: rfc
---

Status: draft. Author: hiroshi.

Problem: current approach couples clients across services, churn is 7 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 3 quarters.

Open question: do we version the package semver-strict or calendar?
