-- What a purchase paid is paid_minor_units, pairing with refunded_minor_units; price_minor_units stays an
-- item's price. A deleted game's slug and title stay on its purchases, so a player's history still names it.
ALTER TABLE purchases RENAME COLUMN price_minor_units TO paid_minor_units;
ALTER TABLE purchases ADD COLUMN deleted_game_slug TEXT;
ALTER TABLE purchases ADD COLUMN deleted_game_title TEXT;
