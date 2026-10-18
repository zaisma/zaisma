-- Passkeys: sign back in with Face ID, a fingerprint or a device PIN instead of an email code.
-- Only the public key is kept; the private key never leaves the player's device or password manager.
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,               -- the credential ID, base64url
  account_id TEXT NOT NULL REFERENCES accounts(id),
  public_key TEXT NOT NULL,          -- SPKI, base64url
  alg INTEGER NOT NULL,              -- -7 (ES256) or -257 (RS256)
  sign_count INTEGER NOT NULL,
  name TEXT NOT NULL,                -- where it was added, like "Mac" or "iPhone"
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX passkeys_by_account ON passkeys (account_id);
