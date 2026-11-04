-- A game its developer deletes waits a week before it's erased, so they can bring it back (docs/DECISIONS.md, "Deleting an
-- account deletes its games", and DEVELOPER-API.md, DELETE /games/:slug). Adds only; nothing is rebuilt or deleted.

-- When a waiting game is erased, null for a deletion that doesn't wait (a deleted account, Zaisma's own), and the
-- review status and reason it had before, which a bring-back puts back.
ALTER TABLE game_deletions ADD COLUMN erases_at_ms INTEGER;
ALTER TABLE game_deletions ADD COLUMN review_status_before TEXT;
ALTER TABLE game_deletions ADD COLUMN review_reason_before TEXT;

-- A deletion a key, an AI app or the dashboard asked for, which only the developer approves on zaisma.com with a passkey tap.
CREATE TABLE game_deletion_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('delete_game', 'erase_game_now')),
  is_asked_from_dashboard INTEGER NOT NULL DEFAULT 0,
  request_status TEXT NOT NULL DEFAULT 'waiting' CHECK (request_status IN ('waiting', 'approved', 'declined')),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  answered_at_ms INTEGER
);
CREATE INDEX game_deletion_requests_by_account ON game_deletion_requests (account_id, request_status);
CREATE INDEX game_deletion_requests_by_game ON game_deletion_requests (game_id);
