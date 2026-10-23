-- The challenges passkey sign-ins and taps are asked to sign (apps/site/src/passkeys.ts). Each is kept as a hash for
-- 5 minutes and taken once, so a request sent again (with the same cookie and body) finds nothing to match.
-- Adds a table and changes no rows.
CREATE TABLE passkey_challenges (
  challenge_sha256 TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  account_id TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX passkey_challenges_created ON passkey_challenges (created_at_ms);
