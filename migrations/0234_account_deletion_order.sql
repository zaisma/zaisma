-- A deleted developer's big files stay in storage while a kept game's versions use them, and the daily cleanup deletes them after that,
-- so a file's row no longer needs its owner's row. Every row and column is copied as it stands.
CREATE TABLE owned_blobs_without_owner_row (
  owner_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  released_at_ms INTEGER,
  PRIMARY KEY (owner_id, sha256)
);
INSERT INTO owned_blobs_without_owner_row (owner_id, sha256, size_bytes, created_at_ms, released_at_ms) SELECT owner_id, sha256, size_bytes, created_at_ms, released_at_ms FROM owned_blobs;
DROP TABLE owned_blobs;
ALTER TABLE owned_blobs_without_owner_row RENAME TO owned_blobs;

-- A deleted account's sign-in that Supabase didn't take at the time, tried again until it does. Holds the sign-in's ID and nothing else of the person's.
CREATE TABLE waiting_sign_in_deletions (
  account_id TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL
);
