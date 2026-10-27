-- Paid games: a game can sell itself once. full_game_item_name names the permanent content item a player must own to play (NULL:
-- free to play); demo_game_id names another of the developer's games, free to play, that the page links as its demo (NULL: none).
-- is_on_game_page puts an item under Add-ons on the game page as well as in the game. Adds only; nothing is rebuilt or deleted.

ALTER TABLE games ADD COLUMN full_game_item_name TEXT;
ALTER TABLE games ADD COLUMN demo_game_id TEXT;
ALTER TABLE game_items ADD COLUMN is_on_game_page INTEGER NOT NULL DEFAULT 0;
