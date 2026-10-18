-- Confirm it's you for keys and deletes (docs/DECISIONS.md, "How usernames and passwords work"): Zaisma
-- records how each session last proved it's them (Supabase's own record can't tell a passkey from an email
-- code), a passkey says from when it can approve keys and changes, and an account can cut off older sessions.

-- How a session last proved it's them: kept a day, and deleted with the account.
CREATE TABLE session_proofs (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  proof_kind TEXT NOT NULL CHECK (proof_kind IN ('passkey', 'password', 'email_code', 'google', 'discord')),
  passkey_id TEXT,
  proved_at_ms INTEGER NOT NULL
);
CREATE INDEX session_proofs_by_account ON session_proofs (account_id);
CREATE INDEX session_proofs_by_time ON session_proofs (proved_at_ms);

-- From when a passkey can make API keys and approve changes to how the account signs in. Existing passkeys approve at once (0).
ALTER TABLE passkeys ADD COLUMN approves_from_at_ms INTEGER NOT NULL DEFAULT 0;

-- Whether the account has ever had a passkey (0 or 1), so one added after all were removed still waits.
ALTER TABLE accounts ADD COLUMN has_had_passkey INTEGER NOT NULL DEFAULT 0;
UPDATE accounts SET has_had_passkey = 1 WHERE id IN (SELECT account_id FROM passkeys);

-- Sessions signed in before this time are refused (a new password, or Sign out on every device); null when never.
ALTER TABLE accounts ADD COLUMN sessions_ended_at_ms INTEGER;
