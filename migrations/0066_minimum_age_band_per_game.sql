-- Minimum age band per game (docs/DECISIONS.md, "Games can keep out younger age bands"): a developer keeps
-- their game from younger accounts. Above 13 the whole game needs an account, since only accounts have an age.

-- The youngest age that can play, in years: 13 (everyone), 16 or 18. Never a band name.
ALTER TABLE games ADD COLUMN minimum_player_age_years INTEGER NOT NULL DEFAULT 13 CHECK (minimum_player_age_years IN (13, 16, 18));

-- The key behind the game entry to an accounts-only game's public address (packages/core/src/game-access.ts).
-- A new one ends every entry handed out so far; internal only, never in an answer.
ALTER TABLE games ADD COLUMN entry_signing_key TEXT;
UPDATE games SET entry_signing_key = lower(hex(randomblob(16)));
