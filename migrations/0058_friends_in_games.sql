-- Friends in games (docs/DECISIONS.md, "How friends in games works"): a game on its own servers says
-- which of its rooms a signed-in player is in (Zaisma.friends.setRoom, or joinRoom({ serverUrl })), so
-- a friend's Join works there too. Those rows carry the server's address (server_url, one of the
-- game's own servers); a Zaisma room's rows have none. The game's page keeps them fresh every couple
-- of minutes, and they count for 5 minutes after the last time it did.
ALTER TABLE room_players ADD COLUMN server_url TEXT;
