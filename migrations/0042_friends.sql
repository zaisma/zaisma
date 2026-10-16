-- Friends (docs/DECISIONS.md, "How friends work"): two accounts become friends when one accepts the
-- other's invite, a link or code given by hand. Never a stranger pressing "Add friend".

-- One row each way, so an account's friends are one lookup. Added and removed in pairs; deleted with
-- either account.
CREATE TABLE friendships (
  account_id TEXT NOT NULL,
  friend_account_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, friend_account_id)
);

-- An invite one account made: its invite_code (8 letters and digits, the link's last part) works once, for
-- a week. Deleted when used, taken back, or with the account; expired ones are cleared daily.
CREATE TABLE friend_invites (
  invite_code TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX friend_invites_account ON friend_invites(account_id);
