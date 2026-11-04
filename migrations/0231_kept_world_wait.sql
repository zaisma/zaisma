-- A kept room's world its developer deletes or ends through the API waits a week before it's erased, so they can bring it
-- back (DEVELOPER-API.md, Kept rooms), and a passkey tap on zaisma.com can erase it sooner. SQLite can't change a CHECK in
-- place, so game_deletion_requests is made again with every row.

-- When a waiting world is erased; null for a world that isn't waiting.
ALTER TABLE kept_rooms ADD COLUMN erases_at_ms INTEGER;

CREATE TABLE game_deletion_requests_rebuilt (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('delete_game', 'erase_game_now', 'erase_kept_room_now')),
  room_code TEXT,
  is_asked_from_dashboard INTEGER NOT NULL DEFAULT 0,
  request_status TEXT NOT NULL DEFAULT 'waiting' CHECK (request_status IN ('waiting', 'approved', 'declined')),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  answered_at_ms INTEGER,
  CHECK ((request_kind = 'erase_kept_room_now') = (room_code IS NOT NULL))
);
INSERT INTO game_deletion_requests_rebuilt (id, account_id, game_id, request_kind, is_asked_from_dashboard, request_status, created_at_ms, expires_at_ms, answered_at_ms)
  SELECT id, account_id, game_id, request_kind, is_asked_from_dashboard, request_status, created_at_ms, expires_at_ms, answered_at_ms FROM game_deletion_requests;
DROP TABLE game_deletion_requests;
ALTER TABLE game_deletion_requests_rebuilt RENAME TO game_deletion_requests;
CREATE INDEX game_deletion_requests_by_account ON game_deletion_requests (account_id, request_status);
CREATE INDEX game_deletion_requests_by_game ON game_deletion_requests (game_id);
