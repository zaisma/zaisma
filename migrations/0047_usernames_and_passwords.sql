-- Usernames and passwords (docs/DECISIONS.md, "Making an account takes a birthday, a username and a
-- password, nothing else"): an account's name becomes its username, public and unique ignoring case.

ALTER TABLE accounts RENAME COLUMN name TO username;

-- Usernames have no spaces or dashes: underscores stand in for them. Anything else a username can't hold
-- stays until the player picks a new one on the account page, which asks them to.
UPDATE accounts SET username = REPLACE(REPLACE(TRIM(username), ' ', '_'), '-', '_');

-- Two the same ignoring case: every one after the first gets the end of its player ID.
UPDATE accounts SET username = SUBSTR(username, 1, 13) || '_' || SUBSTR(player_id, -6)
WHERE EXISTS (
  SELECT 1 FROM accounts earlier
  WHERE LOWER(earlier.username) = LOWER(accounts.username)
    AND (earlier.created_at_ms < accounts.created_at_ms OR (earlier.created_at_ms = accounts.created_at_ms AND earlier.id < accounts.id))
);

CREATE UNIQUE INDEX accounts_username ON accounts(username COLLATE NOCASE);

-- When the account's password was last set, or NULL while it has none (made with an email code, Google
-- or Discord). Supabase keeps the password's hash; this only says one exists.
ALTER TABLE accounts ADD COLUMN password_changed_at_ms INTEGER;
