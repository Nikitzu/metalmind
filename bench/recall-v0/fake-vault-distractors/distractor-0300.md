---
name: RFC-064 - per-environment config layering
type: rfc
---

Status: draft. Author: hiroshi.

Problem: current approach couples flags across services, churn is 15 PRs/week.

Proposal: extract to a shared package, opt-in migration, deprecate old path over 6 quarters.

Open question: do we version the package semver-strict or calendar?
