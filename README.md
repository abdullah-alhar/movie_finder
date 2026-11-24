# AfterShow

AfterShow is a movie browser built with Node.js, Express, and browser JavaScript. Search Tamil and dubbed movie catalogues, open a title to view its information, and choose a stream or download when the source offers one.

## Run locally

Use Node.js 22.13 or newer. In the project folder, run:

```sh
npm ci
npm start
```

Open http://127.0.0.1:5050. Press Control+C to stop. For automatic server restarts during development, use `npm run dev`.

## Catalogue and media

Browse, search and Series read the providers directly. Visible catalogue pages refresh every minute and when you return to the tab. Cards load posters directly and read the provider’s current release quality. A provider outage displays a retry action. Movie files stay on the source site.

## Optional settings

Copy `.env.example` to `.env` if you want to customize the port or add keys. Node reads this file on startup.

| Setting | Purpose |
| --- | --- |
| PORT | Local port, default 5050 |
| TMDB_API_KEY | TMDB v3 API key for discovery, posters, descriptions, cast, and recommendations |
| OMDB_API_KEY | IMDb rating and vote count from OMDb |
| MOVIE_SECRET | Persistent signing secret for movie and media links. Production requires at least 32 characters |
| TRUSTED_HOSTS | Comma-separated list of allowed incoming hostnames |
| SITE_URL | Public HTTPS origin for the sitemap and host check; defaults to the Vercel production hostname when available |
| APPROVED_ORIGINS | Comma-separated extra HTTPS origins for custom links (optional) |

Local development uses a temporary signing key. Set `MOVIE_SECRET` to keep links valid across restarts.

## Deploy to Vercel

Import this repository as one project and use the Express framework preset. Use the repository root and leave the build command and output directory at their defaults. Vercel serves the frontend assets from `public/` and runs the backend from `server.js`.

Set `MOVIE_SECRET` for Preview and Production before deploying. Generate a value with `openssl rand -hex 32` and keep it stable across deployments. Add the optional metadata keys if available. Vercel deployment, branch and production hostnames are accepted automatically when system environment variables are enabled. Put any additional custom domains in `TRUSTED_HOSTS`.

The provider catalogue URLs (isaidub, moviezda) are stored in the database and managed via the admin dashboard at `/admin/dashboard`. They are not configured via environment variables.

The app stores no catalogue or playback history in the database. Opening a title checks the provider for current seasons, episodes and qualities.

### Search engines

Set `SITE_URL` to your preferred public HTTPS origin (for example, `https://aftershow.example`) and deploy. `/robots.txt` allows crawling and points to `/sitemap.xml`, which lists the homepage, Movies, and Series. In Google Search Console, submit the sitemap once and use URL Inspection to check individual titles.

### Enable Vercel Web Analytics

In the Vercel project, open **Analytics**, click **Enable**, and choose **HTML** in the setup dropdown. If Vercel shows a project-specific script URL, set `ANALYTICS_SCRIPT_PATH` in the Production environment to the path shown (such as `/<project-path>/script.js`). The default is `/_vercel/insights/script.js`. Redeploy to production, visit the homepage without a content blocker, and verify that the browser loads the script and sends a successful `/view` request. Check for the visits in the Analytics dashboard.

Tracking runs on public app pages in Vercel Production only, not on the admin or error pages. Page URLs are reported without query strings or fragments, and movie identifiers are replaced with a shared path.

## Tests

```sh
npm test
```

Tests use local fixtures for upstream responses and a temporary local HTTP port for end-to-end route checks.

## Git

The repository root contains the app. Dependency versions are pinned in `package-lock.json`. Local settings, signing keys, installed packages, logs and archive files are ignored.
