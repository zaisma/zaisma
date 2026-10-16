-- Accounts-only games (docs/DECISIONS.md, "Games decide who plays"): what a game needs a Zaisma
-- account for. none (the default: guests play everything), multiplayer (guests play alone, only
-- accounts get player passes) or whole_game (the game page asks guests to sign in before Play, and
-- only accounts get player passes).
ALTER TABLE games ADD COLUMN account_requirement TEXT NOT NULL DEFAULT 'none';
