-- Game server endpoints (docs/DECISIONS.md, "Game servers are full building blocks"): requests from a
-- game to its own game server's onRequest, outside any room, counted per game per day beside room use,
-- for the developer's stats and the free 1 million a month. Nothing about players.
ALTER TABLE room_usage ADD COLUMN game_server_request_count INTEGER NOT NULL DEFAULT 0;
