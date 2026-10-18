-- Publish later: when a draft goes live by itself. Cleared once it's published.
ALTER TABLE versions ADD COLUMN publish_at INTEGER;
CREATE INDEX versions_publish_at ON versions(publish_at) WHERE publish_at IS NOT NULL;

-- Big files arrive in parts, so storage can't check their SHA-256 for us. They're kept apart
-- (R2: owned/<owner id>/<sha256>) and only the owner's own versions can use them, so a file sent
-- under someone else's hash can never end up in another developer's game.
CREATE TABLE owned_blobs (
  owner_id TEXT NOT NULL REFERENCES owners(id),
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, sha256)
);
