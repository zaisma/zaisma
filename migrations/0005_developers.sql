-- Developer accounts: any account can own games and manage them through the developer API
-- (the MCP, the upload command and the dashboard all use it).

-- API keys for the MCP and the upload command. We keep only a hash of the secret part.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX api_keys_account ON api_keys(account_id);

-- Visibility is the developer's; status (live, held, removed) stays ours. Games made before this were listed.
ALTER TABLE games ADD COLUMN visibility TEXT NOT NULL DEFAULT 'listed' CHECK (visibility IN ('draft', 'listed', 'unlisted', 'private'));
-- Device labels, comma-separated: devices (phone, tablet, computer), controls (touch, keyboard-mouse, gamepad),
-- screen ('', portrait, landscape, either).
ALTER TABLE games ADD COLUMN devices TEXT NOT NULL DEFAULT '';
ALTER TABLE games ADD COLUMN controls TEXT NOT NULL DEFAULT '';
ALTER TABLE games ADD COLUMN screen TEXT NOT NULL DEFAULT '';
-- A new title or description for a game players can already see waits here until it's reviewed (JSON).
ALTER TABLE games ADD COLUMN details_draft TEXT;

-- Covers and screenshots. Nothing is shown until it's approved. Files are in R2 (zaisma-games, images/).
CREATE TABLE game_images (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  kind TEXT NOT NULL CHECK (kind IN ('cover', 'screenshot')),
  content_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL
);
CREATE INDEX game_images_game ON game_images(game_id, kind, created_at);
CREATE INDEX game_images_status ON game_images(status, created_at);
