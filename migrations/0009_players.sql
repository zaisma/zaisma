-- How a game is played: single-player, local multiplayer and online multiplayer, with player counts.
-- JSON set by the developer, like {"single":true,"local":{"min":2,"max":4,"style":"co-op"}}; '' when not set.
ALTER TABLE games ADD COLUMN players TEXT NOT NULL DEFAULT '';
