-- Game server reach and secrets (docs/DECISIONS.md, "Game servers are full building blocks"): the hosts a
-- game's server may call, as a JSON list the developer sets, and when its secrets last changed, so running
-- rooms read them again. The secrets themselves live in the game's secrets object in the rooms Worker, never here.
ALTER TABLE games ADD COLUMN game_server_allowed_hosts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE games ADD COLUMN secrets_changed_at_ms INTEGER;
