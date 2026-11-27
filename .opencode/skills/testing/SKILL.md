name: testing
description: Use when adding or modifying tests. Covers fixtures, test patterns, and what npm test must cover.
---
# Testing

## When to use
Any time you add new test files or modify existing ones in `test/`. Also use when determining whether a code change requires a new test case.

## How it works here
Tests live in `test/` and are run with `npm test` which executes `node --test test/*.test.js`. The test suite covers:

- **providers.test.js** - unit tests for search logic, normalization, similarity scoring, and movie indexing. Uses fixtures from `test/` directory.
- **metadata.test.js** - tests for TMDB and OMDb metadata lookups, title matching, and artwork discovery.
- **admin-postgres.test.js** - tests for admin-store.js database functions (loadData, saveData, config loading).
- **routes.test.js** - integration tests for the Express API routes (search, browse, movie pages, admin).

Test fixtures are stored in the `test/` directory and contain pre-recorded HTML from catalogue sites, JSON data, or mock responses. Fixtures allow tests to run without network access.

Key testing patterns:
- Tests use `import` (ES modules) since the project uses `"type": "module"`.
- Each test file focuses on a specific concern (search, metadata, admin, routes).
- Fixture files are named to match the functionality they test.
- Tests verify both happy paths and error conditions (missing data, network failures, invalid input).
- `npm test` must pass before every commit.

## Rules
- Every new behavioural change must include a test. Run `npm test` before committing.
- Do not modify existing test assertions without a matching code change.
- Fixtures should be kept up-to-date; if a catalogue site structure changes, update the relevant fixtures.
- Tests that require a database use the `EXPRESS_DATABASE_URL` env var or a test-specific connection string.
- Do not add network-dependent tests; all catalogue site interactions should be mocked via fixtures.
- Keep test files focused — one concern per file, matching the structure of the existing suite.