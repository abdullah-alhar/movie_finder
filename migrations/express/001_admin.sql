CREATE SCHEMA IF NOT EXISTS aftershow_express;
CREATE TABLE IF NOT EXISTS aftershow_express.admin (
  email text PRIMARY KEY, password_hash text NOT NULL,
  singleton boolean UNIQUE NOT NULL DEFAULT true CHECK(singleton)
);
CREATE TABLE IF NOT EXISTS aftershow_express.settings (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  config jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0,
  import_digest text NOT NULL
);
CREATE TABLE IF NOT EXISTS aftershow_express.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS aftershow_express.sessions (
  digest text PRIMARY KEY, email text NOT NULL REFERENCES aftershow_express.admin(email)
    ON DELETE CASCADE, csrf text NOT NULL, expires timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON aftershow_express.sessions(expires);
