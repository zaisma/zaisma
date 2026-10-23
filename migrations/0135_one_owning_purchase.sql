-- A player owns a permanent item through one completed purchase or grant (packages/core/src/items.ts,
-- recordGrant), so two grants of it at once make one purchase, and refunding it leaves the item unowned.
-- Should a player already own one through more than one, the earliest keeps it and the others are marked
-- failed, which owns nothing; no row is deleted. Adds an index and changes only those rows.
UPDATE purchases SET purchase_status = 'failed'
WHERE item_kind = 'permanent' AND purchase_status = 'completed' AND EXISTS (
  SELECT 1 FROM purchases earlier
  WHERE earlier.game_id = purchases.game_id AND earlier.player_id = purchases.player_id AND earlier.item_name = purchases.item_name
    AND earlier.item_kind = 'permanent' AND earlier.purchase_status = 'completed'
    AND (earlier.created_at_ms < purchases.created_at_ms OR (earlier.created_at_ms = purchases.created_at_ms AND earlier.id < purchases.id))
);
CREATE UNIQUE INDEX purchases_one_owner ON purchases (game_id, player_id, item_name) WHERE item_kind = 'permanent' AND purchase_status = 'completed';
