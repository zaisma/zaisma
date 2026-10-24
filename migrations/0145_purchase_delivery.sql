-- Getting purchases to games exactly once. A purchase is handled when the game, its game server or the
-- developer's own server has taken it: whoever wins the short lease (handling_until_ms) hands it over and sets
-- handled_at_ms; a refund or chargeback is handed over the same way, on the refund_ columns. Where a game's
-- purchases go is its purchase_delivery.
ALTER TABLE purchases ADD COLUMN handling_until_ms INTEGER;
ALTER TABLE purchases ADD COLUMN handled_at_ms INTEGER;
ALTER TABLE purchases ADD COLUMN refund_handling_until_ms INTEGER;
ALTER TABLE purchases ADD COLUMN refund_handled_at_ms INTEGER;
CREATE INDEX purchases_unhandled ON purchases (game_id, player_id, handled_at_ms);
ALTER TABLE games ADD COLUMN purchase_delivery TEXT NOT NULL DEFAULT 'game' CHECK (purchase_delivery IN ('game','game_server','own_server'));
