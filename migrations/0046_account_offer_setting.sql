-- Saves without Zaisma screens (docs/DECISIONS.md, "Zaisma hosts saves; the game owns their rules"): a game
-- can turn off the "Keep your progress" card that offers guests an account, for games with their own way of asking.
ALTER TABLE games ADD COLUMN account_offer_enabled INTEGER NOT NULL DEFAULT 1;
