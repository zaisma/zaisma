-- Game server CPU on the player-hour meter: the time a game's own game server ran in its rooms, per game
-- per day, as in room_usage. Each player-hour includes 25 CPU-seconds; every 50 past that counts one more.
ALTER TABLE room_usage ADD COLUMN game_server_cpu_duration_ms INTEGER NOT NULL DEFAULT 0;
-- Room traffic: the bytes players sent (message_count is how many), and the messages and bytes the rooms
-- sent them, each counted once per player it went to.
ALTER TABLE room_usage ADD COLUMN inbound_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN outbound_message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN outbound_size_bytes INTEGER NOT NULL DEFAULT 0;
-- And a game's biggest message types per day, each way: a message's data.type, or (none), (bytes),
-- (zaisma) for Zaisma's own and (other) past a room's first 20. Each room adds its top 10 each way when it
-- records its use.
CREATE TABLE room_message_types (
  game_id TEXT NOT NULL,
  date TEXT NOT NULL,
  message_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  largest_size_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, date, message_type, direction)
);
