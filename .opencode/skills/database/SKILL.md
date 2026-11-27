name: database
description: Use when changing admin-store.js, migrations, or anything that reads or writes the database. Covers schema, migration steps and query rules.
---
# Database

## When to use
Any change to `admin-store.js`, the migration files in `migrations/express/`, or anything that reads or writes the `aftershow_express` PostgreSQL schema. This includes adding new config fields, changing admin authentication, modifying audit logging, or altering session storage.

## How it works here
The admin dashboard and config system use PostgreSQL via the `pg` package. The database connection is established in `admin-store.js` using `new pg.Pool` with the `EXPRESS_DATABASE_URL` connection string. The schema `aftershow_express` contains these tables:

- **admin** - stores admin user email and password hash (PBKDF2-SHA256, 310k iterations). Singleton pattern ensures only one admin account exists.
- **settings** - key-value store for app config, currently holds `isaidub_url`, `moviezda_url`, and `customLinks` JSON array. Each row has a `revision` counter for optimistic concurrency.
- **audit** - append-only log of admin actions (action, who, timestamp), limited to 60 most recent entries.
- **sessions** - JWT-like session tokens digested with SHA-256, linked to admin email, with 24-hour TTL.

Key functions in `admin-store.js`:
- `database()` - creates or returns the pooled connection
- `loadData(client = database(), bypassCache = false)` - loads config + admin data from DB with 30-second in-memory cache
- `saveData(data, {revoke, session})` - transactionally writes config, admin password, activity log, and sessions
- `loadConfig({ cachedOnly })` - reads config from DB with caching
- `configEpoch()` - version stamp for config change detection
- `invalidateCache()` - clears the in-memory cache to force a DB re-read

Migrations run via ` migrations/express/001_admin.sql` which creates the schema and all tables. New schema changes require a new migration file.

## Rules
- Always add a new migration file in `migrations/express/` for any schema change — never alter existing migrations.
- Never put provider URLs in code; they must be managed via the admin dashboard and stored in the `settings` table.
- Add a test for each new query or data shape in `test/` — `npm test` must pass.
- The `admin` table is singleton: only one row should ever exist. Guard against accidental duplicate inserts.
- Password hashes use PBKDF2-SHA256 with 310,000 iterations and a 32-byte salt. Do not change the hash format without updating `admin.js` accordingly.
- Custom links (`customLinks` array in `settings.config`) are user-managed via the admin UI. Each entry has `label`, `url`, `notes`, and `addedAt`.
- Always test database changes with `npm test` — tests use local fixtures and an in-memory or test database.
- The `EXPRESS_DATABASE_URL` env var is required in production; in development it can be omitted and dev fallbacks will be used.