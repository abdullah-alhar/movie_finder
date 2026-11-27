name: vercel-deploy
description: Use when configuring Vercel deployment, managing env vars, or following the RELEASE.md checklist.
---
# Vercel Deploy

## When to use
Any configuration related to Vercel deployment, environment variables, the `vercel.json` preset, or the release checklist in `RELEASE.md`. Also use when preparing a new production release.

## How it works here
The project is configured for Vercel with these files:
- **vercel.json** - Express preset configuration. Sets the runtime to Node.js, defines the health check route, and configures analytics.
- **.vercelignore** - Files to exclude from Vercel deployment (`.env`, `.env.*`, `admin-data.json`, `instance/`, `*.sqlite3*`, `*.zip`).
- **.env.example** - Template for required environment variables documented for new developers.

### Required env vars (from `.env.example` and `server.js`)
- `PORT` - Server port (default 5050)
- `TMDB_API_KEY` - The Movie Database API key for metadata
- `OMDB_API_KEY` - OMDb API key for ratings and posters
- `MOVIE_SECRET` - At least 32 characters for signed link HMAC keys. **Must not be committed to repo.**
- `TRUSTED_HOSTS` - Comma-separated list of approved hostnames for host validation.
- `SITE_URL` - Public HTTPS origin for sitemap and host checks (no path).
- `EXPRESS_DATABASE_URL` - PostgreSQL connection string for admin dashboard, sessions, and provider config. Required in production.
- `APPROVED_ORIGINS` - Comma-separated additional origins for custom link whitelisting (managed via admin dashboard, not code).

### Vercel preset (`vercel.json`)
```json
{
  "functions": "api/",
  "routes": {
    "/api/catalogue": { "methods": ["GET"] },
    "/api/suggestions": { "methods": ["GET"] },
    "/api/discovery": { "methods": ["GET"] },
    "/api/discover": { "methods": ["GET"] },
    "/api/test-link": { "methods": ["GET"] },
    "/movie/": { "methods": ["GET"] },
    "/watch/": { "methods": ["GET"] },
    "/download/": { "methods": ["GET"] },
    "/admin/": { "methods": ["GET", "POST"] },
    "/_vercel/insights/": "internal"
  }
}
```

### RELEASE.md checklist
Follow `RELEASE.md` before deploying:
- [ ] All env vars set (especially `MOVIE_SECRET` 32+ chars)
- [ ] `npm test` passes green
- [ ] No new dependencies
- [ ] Code matches existing style
- [ ] Database migrations are up to date
- [ ] Admin dashboard authentication confirmed

## Rules
- Never commit `MOVIE_SECRET` or `.env` files to the repository.
- In production, `EXPRESS_DATABASE_URL` is required — the admin dashboard will fail without it.
- `TRUSTED_HOSTS` must include the production Vercel URL and any custom domains.
- `SITE_URL` must match the production domain for sitemap/robots.txt correctness.
- Run `npm run dev` locally to verify auto-restart works before deploying.
- After deploy, verify search, movie page, Series, and admin dashboard all function correctly.
- Update `RELEASE.md` with deployment notes after each release.