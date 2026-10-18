-- AI apps connect to the MCP by signing in ("AI apps connect to the MCP by signing in." in docs/DECISIONS.md).
-- A connection is an api_keys row of kind connected_app, so every check, log and list that holds keys holds it too;
-- its tokens are opaque and stored by hash. Adds only.
ALTER TABLE api_keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'api_key' CHECK (kind IN ('api_key', 'connected_app'));
ALTER TABLE api_keys ADD COLUMN mcp_client_id TEXT;
ALTER TABLE api_keys ADD COLUMN connected_app_host TEXT;

-- AI apps that connect to the MCP by signing in: registered (mcp_client_…) or read from their metadata document (the ID is its URL).
CREATE TABLE mcp_clients (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_urls TEXT NOT NULL,           -- JSON list
  registration_kind TEXT NOT NULL CHECK (registration_kind IN ('registration', 'metadata_document')),
  token_endpoint_auth_method TEXT NOT NULL CHECK (token_endpoint_auth_method IN ('none', 'client_secret_basic', 'client_secret_post')),
  client_secret_sha256 TEXT,
  fetched_at_ms INTEGER,                 -- metadata documents only
  created_at_ms INTEGER NOT NULL
);

-- A yes on the connect page, for 2 minutes and one use: what the app may do, chosen there.
CREATE TABLE connected_app_codes (
  code_sha256 TEXT PRIMARY KEY,
  mcp_client_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  redirect_url TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  connected_app_name TEXT NOT NULL,
  access_level TEXT NOT NULL,
  area_access TEXT,
  game_slugs TEXT,
  ends_at_ms INTEGER,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX connected_app_codes_account ON connected_app_codes(account_id);

CREATE TABLE connected_app_tokens (
  token_sha256 TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  token_kind TEXT NOT NULL CHECK (token_kind IN ('access', 'refresh')),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER,                 -- access tokens; refresh tokens last as long as the connection
  rotated_at_ms INTEGER
);
CREATE INDEX connected_app_tokens_key ON connected_app_tokens(api_key_id);
