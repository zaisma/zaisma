-- Protect your account (docs/DECISIONS.md, "Accounts get protected once there's something to lose"): when the
-- home page asked once for a passkey or an email; NULL until it has.
ALTER TABLE accounts ADD COLUMN protection_offered_at_ms INTEGER;
