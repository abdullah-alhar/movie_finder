name: providers
description: Use when adding, modifying, or debugging catalogue site parsing (isaidub, moviezda). Covers parser logic, failure handling, retry behaviour, and source-specific patterns.
---
# Providers

## When to use
Any change to catalogue site parsing logic in `providers.js`, `sources.js`, or the pattern matching for `isaidub` and `moviezda`. Also use when adding a new source or fixing parse failures.

## How it works here
The `providers.js` module handles web scraping of two catalogue sites:
- **isaidub**: Tamil dubbed movies. Uses `moviePatterns.isaidub` (`/^\/movie\/[a-z0-9-]+\/?$/i`) to match item URLs. The `parseListing()` function extracts title, year, quality, and poster from search result pages. Categories are generated via the `categories()` function which supports A-Z indexing and year-based browsing.
- **moviezda**: Tamil and dubbed content. Uses `moviePatterns.moviezda` (`/^\/[a-z0-9-]+-(?:movie|(?:web-?)?series)(?:-\d+|-moviesda)?\/?$/i`) for URL matching. Shares similar parsing logic but with different URL structures and category paths.

Key functions:
- `readHTML(address, timeout)` - fetches a page with timeout and active-request throttling (max 24 concurrent)
- `parseListing(html, url, source)` - extracts movie items from HTML using cheerio
- `categories(query, source, section)` - generates category paths for browsing
- `pageUrl(source, category, page)` - builds paginated URLs per source
- `releaseQuality(label)` - classifies quality labels (CAM, WEB-DL, Blu-ray, etc.)
- `options(movie)` - follows link trees to find streaming/download options
- `resolveMedia(page, watch)` - resolves final redirect target for watch/download

Failure handling: Each `listing()` call is wrapped in a retry guard. If a source is down, `origins[source]` is removed and the fallback dev domain is used in non-production. The `options()` and `resolveMedia()` functions have built-in timeouts (15s) and depth limits to prevent runaway scraping.

## Rules
- Never hardcode provider URLs in source code — they must come from the database via the admin dashboard.
- When modifying parse patterns, update both `moviePatterns` and the `folder`/`itemPattern` regexes consistently.
- Always test changes with `npm test` — tests use local fixtures in `test/` and mock the catalogue sites.
- Do not increase the concurrent request limit (24) or timeout (4500ms) without a very good reason; these are tuned for stability.
- If a source URL changes, update the fallback domain in `sources.js` `DEV_FALLBACK_DOMAINS` for dev/testing, and the database entry for production.
- Match the existing code style: functional composition, early returns, descriptive variable names, and consistent use of `const`/`let`.
