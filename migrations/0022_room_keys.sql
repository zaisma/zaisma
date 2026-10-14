-- A checked browser's key to multiplayer (docs/DECISIONS.md, room-count protection): when Cloudflare's
-- check on Play says a real browser pressed it, the game page gets a key and hands it to its game,
-- which trades it for a few player passes. So bots can't fill rooms or fake "playing now". A random ID
-- and how many passes it gave; nothing about the player. Deleted after a day.
CREATE TABLE room_keys (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  passes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX room_keys_issued ON room_keys(issued_at);
