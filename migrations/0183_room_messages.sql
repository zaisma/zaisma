-- Sends to every room a game scheduled for later (POST /games/:slug/room-messages with send_at): the rooms
-- Worker's every-minute cron hands each out when it's due (apps/rooms/src/room-reach.ts, sendDueRoomMessages).
-- room_message_json: the message as the developer sent it. labels_json: the labels a room must hold, or null
-- for every room. sent_at_ms: when it went out (null while it waits); delivered_room_count: how many rooms took it.
CREATE TABLE IF NOT EXISTS scheduled_room_messages (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  room_message_json TEXT NOT NULL,
  labels_json TEXT,
  send_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  sent_at_ms INTEGER,
  delivered_room_count INTEGER
);
CREATE INDEX IF NOT EXISTS scheduled_room_messages_due ON scheduled_room_messages (send_at_ms) WHERE sent_at_ms IS NULL;
CREATE INDEX IF NOT EXISTS scheduled_room_messages_game ON scheduled_room_messages (game_id, created_at_ms);
