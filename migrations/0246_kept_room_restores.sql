-- Restores of a kept room's world to an earlier time, one at a time or every world of a game at once
-- (docs/DEVELOPER-API.md, "Kept rooms"): each keeps Cloudflare's bookmark for the moment just before it, so it can be undone for 30 days.
CREATE TABLE kept_room_restore_batches (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  restore_to_at_ms INTEGER NOT NULL,
  undoes_kept_room_restore_batch_id TEXT,  -- the batch this one undid; NULL for a batch to a time
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  kept_room_count INTEGER NOT NULL DEFAULT 0,
  restored_room_count INTEGER NOT NULL DEFAULT 0,
  skipped_room_count INTEGER NOT NULL DEFAULT 0,
  failed_room_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX kept_room_restore_batches_by_game ON kept_room_restore_batches(game_id, started_at_ms);

CREATE TABLE kept_room_restores (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  restore_to_at_ms INTEGER NOT NULL,
  undo_bookmark TEXT NOT NULL,             -- Cloudflare's bookmark for the moment just before this restore
  undoes_kept_room_restore_id TEXT,        -- the restore this one undid; NULL for a restore to a time
  kept_room_restore_batch_id TEXT,         -- the batch it was part of; NULL for one world alone
  restored_at_ms INTEGER NOT NULL
);
CREATE INDEX kept_room_restores_by_room ON kept_room_restores(game_id, room_code, restored_at_ms);
-- A queue page tried again never restores a world twice.
CREATE UNIQUE INDEX kept_room_restores_once_per_batch ON kept_room_restores(kept_room_restore_batch_id, room_code) WHERE kept_room_restore_batch_id IS NOT NULL;

-- Worlds a batch tried and couldn't restore, named by get_kept_room_restore_batch.
CREATE TABLE kept_room_restore_failures (
  kept_room_restore_batch_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  failed_at_ms INTEGER NOT NULL,
  PRIMARY KEY (kept_room_restore_batch_id, room_code)
);

-- Worlds erased after a developer deleted them: about 28 days long, a nightly copy brings one back through bring_back_kept_room.
CREATE TABLE deleted_kept_rooms (
  game_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  name TEXT,
  saved_size_bytes INTEGER NOT NULL,
  deleted_at_ms INTEGER NOT NULL,
  bring_back_started_at_ms INTEGER,
  bring_back_failed_at_ms INTEGER,
  brought_back_at_ms INTEGER,              -- kept until the window ends, for the day's limit on what's read from the copies
  PRIMARY KEY (game_id, room_code, deleted_at_ms)
);
CREATE INDEX deleted_kept_rooms_by_deleted_at ON deleted_kept_rooms(deleted_at_ms);
-- When a world's deletion started: its week ends at erases_at_ms, and its 28 days start here.
ALTER TABLE kept_rooms ADD COLUMN deleted_at_ms INTEGER;
