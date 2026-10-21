-- Light or dark for a signed-in player's pages on zaisma.com: 'system' follows their device, 'light' and 'dark' fix it.
-- Existing accounts follow their device. Nothing is deleted.
ALTER TABLE accounts ADD COLUMN color_theme TEXT NOT NULL DEFAULT 'system' CHECK (color_theme IN ('system', 'light', 'dark'));
