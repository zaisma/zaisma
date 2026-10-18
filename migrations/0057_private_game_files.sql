-- Private game files stay private (docs/DECISIONS.md, "No game address holds a key" and "Big games
-- are welcome"). Game addresses lose their keys: tester links and previews open at fixed addresses
-- (<slug>--tester, <slug>--preview) that serve only a browser holding Zaisma's access cookie.

-- Tester links open the live version, the newest version that passed or one version the developer
-- picks, until they're turned off or until an end date the developer sets.
ALTER TABLE tester_links ADD COLUMN version_choice TEXT NOT NULL DEFAULT 'live' CHECK (version_choice IN ('live', 'newest_passed', 'picked'));
-- The version a 'picked' link opens; null for the other choices.
ALTER TABLE tester_links ADD COLUMN picked_version_id TEXT;
ALTER TABLE tester_links ADD COLUMN ends_at_ms INTEGER;
-- Every token so far was also part of a game address, which DNS services and networks may have seen.
UPDATE tester_links SET token = lower(hex(randomblob(10)));

-- A preview link is zaisma.com/p/<version id>.<hour>.<HMAC of both with this key>: a fresh one each
-- hour with nothing stored, lasting a day. Turning a version's preview links off replaces the key.
ALTER TABLE versions RENAME COLUMN preview_token TO preview_link_key;
-- The old values were game addresses too.
UPDATE versions SET preview_link_key = lower(hex(randomblob(16))) WHERE preview_link_key IS NOT NULL;

-- How a browser gets into a tester or preview address: the zaisma.com page makes a one-use grant that
-- lasts a minute, and the games server swaps it for an access key it sets as a cookie. Only the
-- SHA-256 of each is kept. Each request checks the pass, and its tester link, here.
CREATE TABLE game_access_passes (
  grant_key_hash TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  -- Which fixed address it opens: 'tester' or 'preview'.
  address_kind TEXT NOT NULL CHECK (address_kind IN ('tester', 'preview')),
  -- The tester link it came through, checked on every request so turning it off works at once.
  tester_id TEXT,
  -- The version a preview opens.
  version_id TEXT,
  created_at_ms INTEGER NOT NULL,
  grant_used_at_ms INTEGER,
  access_key_hash TEXT UNIQUE,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX game_access_passes_expiry ON game_access_passes (expires_at_ms);
CREATE INDEX game_access_passes_version ON game_access_passes (version_id);

-- Which owners sent each shared file (blobs). A version can use a stored file only when its owner sent
-- it themselves, so naming another developer's file by its SHA-256 neither gets it nor says Zaisma has
-- it. Storage still keeps one copy. Files sent before this are sent once more by each owner.
CREATE TABLE blob_owners (
  owner_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (owner_id, sha256)
);
CREATE INDEX blob_owners_sha256 ON blob_owners (sha256);
