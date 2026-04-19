---
name: Operator auth model
type: reference
---

Operators authenticate through **WorkOS SSO** (SAML + OIDC). Only corporate identity — no username/password accounts exist.

**Session model:**

- Session tokens stored in **Redis** under key `sess:<uuid>`, TTL **8 hours**, sliding (resets on each authenticated request).
- Browser cookie: `qf_session`, `HttpOnly`, `Secure`, `SameSite=Lax`.
- Refresh happens server-side — browser never touches the WorkOS refresh token.

**MFA:** required for all production Enterprise-tier operators (enforced by WorkOS). Starter and Fleet tiers can opt out.

**Service-to-service:** internal calls use mTLS via GCP's internal CA. No bearer tokens between services.

**Revocation:** session kill-switch lives in Fleet API admin endpoint `POST /admin/sessions/:uuid/revoke`. Propagates through Redis pub/sub within 2 seconds.
