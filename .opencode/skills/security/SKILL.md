name: security
description: Use when working on signed links, admin auth, host checks, and secret handling.
---
# Security

## When to use
Any change to `links.js` (signed link generation/verification), admin authentication in `admin.js`, host validation (`hostAllowed` in `server.js`), or `MOVIE_SECRET` handling. Also use when adding new security features or fixing vulnerabilities.

## How it works here
Security is layered across the codebase:

### Signed movie/media links (`links.js`)
- All movie and download URLs are signed with an HMAC-SHA256 secret (`MOVIE_SECRET`).
- `sign(kind, value)` creates a token by base64url-encoding the JSON payload and HMAC-signing it.
- `unpack(kind, token)` verifies the signature and decodes the payload.
- `movieFrom(token)` validates the token, extracts movie data, and resolves the current provider origin.
- Legacy support: old Flask-style signatures (20-byte HMAC-SHA1) are also accepted for backward compatibility.
- The secret is resolved via `getSecret()`: first checks `MOVIE_SECRET` env var (min 16 chars), then falls back to hashing `EXPRESS_DATABASE_URL` + salt, then a default stable key.

### Admin authentication (`admin.js`)
- PBKDF2-SHA256 password hashing with 310,000 iterations and 32-byte salt.
- Session-based login with 24-hour cookies.
- Rate limiting: max 5 attempts per IP, 15-minute lockout.
- CSRF protection: required form submissions include a `_csrf` token.
- Session tokens are SHA-256 digested and stored in PostgreSQL.

### Host validation (`server.js`)
- `hostAllowed(host)` checks against `TRUSTED_HOSTS` env var and `VERCEL_URL`/`VERCEL_BRANCH_URL`/`VERCEL_PROJECT_PRODUCTION_URL`.
- Wildcard patterns (`.vercel.app`) and `*.` prefixes are supported.
- Requests from untrusted hosts return 400.
- `TRUSTED_HOSTS` defaults to `localhost,127.0.0.1,[::1],moviesda.dpdns.org`.

### General rules
- Never log `MOVIE_SECRET` or any secret values.
- Provider URLs always come from the database, never hardcoded.
- All URL approvals go through the `approved()` function in `sources.js` which enforces HTTPS, no credentials, public FQDN, and standard port.
- Admin dashboard requires authentication via cookie `af_admin` and password verification.