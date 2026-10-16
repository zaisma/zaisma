-- Sign in with Zaisma (docs/DECISIONS.md, "Sign in with Zaisma ships with Zaisma accounts in games"):
-- an OpenID Connect server for developers' own sites, servers and games with their own accounts.

-- A developer's site or app that players sign in to. Its ID is the OAuth client_id. A confidential
-- app keeps a client secret on its server (only its SHA-256 is kept); a public one (a page or a
-- phone app) has none and signs in with PKCE alone. redirect_urls is a JSON list of exact URLs.
CREATE TABLE sign_in_apps (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  redirect_urls TEXT NOT NULL,
  client_secret_sha256 TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX sign_in_apps_owner ON sign_in_apps(owner_id);

-- A player said yes to an app once: later sign-ins go straight back. Listed on the account page,
-- where the player can remove it; deleted with the account or the app.
CREATE TABLE sign_in_grants (
  account_id TEXT NOT NULL,
  sign_in_app_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  last_used_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, sign_in_app_id)
);
CREATE INDEX sign_in_grants_app ON sign_in_grants(sign_in_app_id);

-- Authorization codes: one use, two minutes, only their SHA-256 kept. scope is OAuth's own
-- space-separated list; code_challenge is PKCE's (S256), NULL when a confidential app sent none.
CREATE TABLE sign_in_codes (
  code_sha256 TEXT PRIMARY KEY,
  sign_in_app_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  redirect_url TEXT NOT NULL,
  code_challenge TEXT,
  nonce TEXT,
  scope TEXT NOT NULL,
  signed_in_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX sign_in_codes_account ON sign_in_codes(account_id);
