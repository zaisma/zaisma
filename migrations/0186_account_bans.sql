-- Account bans (apps/site/src/bans.ts): Zaisma bans an account's developer side, or the whole account, from the
-- admin MCP. ban_scope: developer (its games come down, and it can't make, upload or publish) or whole_account (it
-- can't sign in either); ban_reason: why, a sentence; ban_content_rule: the CONTENT_RULES key it broke, or null.
ALTER TABLE accounts ADD COLUMN banned_at_ms INTEGER;
ALTER TABLE accounts ADD COLUMN ban_scope TEXT CHECK (ban_scope IN ('developer', 'whole_account'));
ALTER TABLE accounts ADD COLUMN ban_reason TEXT;
ALTER TABLE accounts ADD COLUMN ban_content_rule TEXT;

-- The cards that paid Zaisma for an owner (a top-up or Zaisma Pro), as SHA-256 of Stripe's card fingerprint.
CREATE TABLE IF NOT EXISTS owner_cards (
  owner_id TEXT NOT NULL REFERENCES owners(id),
  card_fingerprint_sha256 TEXT NOT NULL,
  first_paid_at_ms INTEGER NOT NULL,
  PRIMARY KEY (owner_id, card_fingerprint_sha256)
);
CREATE INDEX IF NOT EXISTS owner_cards_by_card ON owner_cards(card_fingerprint_sha256);

-- What a ban carries to new accounts: a card, a Stripe account or an email, each as SHA-256 so nothing in it is
-- readable. No foreign key, so a mark outlives the banned account's deletion.
CREATE TABLE IF NOT EXISTS banned_marks (
  mark_kind TEXT NOT NULL CHECK (mark_kind IN ('card', 'stripe_account', 'email')),
  mark_sha256 TEXT NOT NULL,
  banned_account_id TEXT NOT NULL,
  banned_at_ms INTEGER NOT NULL,
  PRIMARY KEY (mark_kind, mark_sha256)
);

-- Another account that used a banned card, waiting for a person (the admin MCP's list_ban_matches).
CREATE TABLE IF NOT EXISTS ban_matches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  mark_kind TEXT NOT NULL,
  banned_account_id TEXT NOT NULL,
  found_at_ms INTEGER NOT NULL,
  decided_at_ms INTEGER,
  decision TEXT CHECK (decision IN ('banned', 'not_the_same_person'))
);
CREATE INDEX IF NOT EXISTS ban_matches_by_decided ON ban_matches(decided_at_ms);
