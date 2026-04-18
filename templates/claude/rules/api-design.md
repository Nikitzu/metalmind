# API & Interface Design

> **Scope**: Principles for designing APIs, module boundaries, and public interfaces
> **Priority**: Apply when creating new endpoints, type contracts, or service boundaries

## Core Principles

- **Contract first**: Define the interface (types, endpoints, error shapes) before writing implementation. Consumers and producers agree on the contract, then build independently.
- **Hyrum's Law**: Every observable behavior of your API will eventually be depended on by someone. Design intentionally — don't leak implementation details through responses, error messages, or timing.
- **One-version rule**: Avoid forcing consumers to choose between API versions. Prefer additive changes (new optional fields) over breaking changes. When breaking changes are unavoidable, migrate all consumers before removing the old path.

## Practical Rules

- Validate at the boundary — all input from external callers is untrusted
- Use specific error types with machine-readable codes, not just HTTP status + message
- Pagination: cursor-based for lists that change, offset-based only for static data
- Never return more data than the consumer needs — over-fetching becomes a contract
- Version in the event/schema namespace (e.g., `safety.v1.speed_alert`), not in URL paths when possible
- Document every public endpoint with request/response examples and error cases
