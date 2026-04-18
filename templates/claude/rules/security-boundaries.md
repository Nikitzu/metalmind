# Security Boundaries

> **Scope**: Three-tier action classification for security-sensitive work
> **Priority**: Always apply. Supplements the Security Limitations in CLAUDE.md.

## Always Do

- Validate and sanitize all external input (user input, API responses, URL params)
- Parameterize database queries — never concatenate user input into SQL
- Encode output to prevent XSS (use framework defaults, don't bypass)
- Use HTTPS for all external communication
- Hash passwords with bcrypt/argon2 — never store plaintext
- Set security headers (CSP, X-Frame-Options, HSTS)
- Use httpOnly + secure cookies for auth tokens
- Run `pnpm audit` when adding new dependencies

## Ask First

Before proceeding with any of these, confirm the approach with the user:

- New authentication or authorization flows
- Storing or processing PII (names, emails, phone numbers, locations)
- Adding new third-party integrations or SDKs
- Changing CORS configuration
- Adding file upload endpoints
- Modifying rate limiting or permission grants
- Adding new API keys or secrets to configuration

## Never Do

- Commit secrets, tokens, or credentials to git
- Log PII or authentication tokens
- Trust client-side validation as the only check
- Disable security headers for convenience
- Use dynamic code execution or raw HTML injection without explicit approval
- Store auth tokens in localStorage (use httpOnly cookies)
- Expose stack traces or internal error details to end users
