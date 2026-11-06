-- The browsers a player has confirmed a saved-card buy in (apps/site/src/buy.ts): each makes its own signing key
-- and keeps the private half where nothing can read it out, and Zaisma keeps only the public half. A saved card pays
-- with one press only in a browser whose key signs the buy; anywhere else the buy is confirmed first.
CREATE TABLE buying_keys (
  account_id TEXT NOT NULL,
  public_key_base64 TEXT NOT NULL,    -- a P-256 public key, raw (65 bytes), base64url
  confirmed_at_ms INTEGER NOT NULL,
  used_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, public_key_base64)
);

-- The buying key a confirm kept, or NULL for a browser that couldn't keep one: only a confirm without a key covers a
-- buy no kept key signs.
ALTER TABLE purchase_confirmations ADD COLUMN buying_public_key_base64 TEXT;
