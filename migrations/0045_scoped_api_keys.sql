-- Scoped API keys (docs/DECISIONS.md, "Developers hold the keys"): a key can be limited to some of the
-- developer's games and to what it may do. Keys made before this keep doing everything, on every game.

-- read, upload, publish or full (shortcuts for a set of area_access), or custom.
ALTER TABLE api_keys ADD COLUMN access_level TEXT NOT NULL DEFAULT 'full' CHECK (access_level IN ('read', 'upload', 'publish', 'full', 'custom'));
-- Only for custom keys: a JSON object of each area's choice, like {"games":"read","versions":"upload",…}.
-- A level's areas come from the code, so a level stays the same words when areas are added.
ALTER TABLE api_keys ADD COLUMN area_access TEXT;
-- A JSON list of the owner's game slugs the key works on, or NULL for every game they have and will make.
ALTER TABLE api_keys ADD COLUMN game_slugs TEXT;
