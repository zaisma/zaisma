-- Items a game sells or grants, and players' purchases and grants of them (packages/core/src/items.ts).
-- Items are the game's own, by name, never Stripe Products: a grant-only item, a game with no Stripe yet and a
-- self-hosted check all need them. Prices are in the currency's minor units, as Stripe counts them, with
-- optional prices per currency (local_prices, JSON). Ownership is read from purchases, never stored apart, so a
-- refund or chargeback can't leave a stale "owned" row. A purchase keeps the player's opaque player ID and the
-- amounts: the developer's sales record, kept when the account is deleted. Adds only.
CREATE TABLE game_items (
  game_id TEXT NOT NULL REFERENCES games(id),
  item_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  item_kind TEXT NOT NULL CHECK (item_kind IN ('permanent', 'consumable')),
  item_category TEXT NOT NULL CHECK (item_category IN ('cosmetic', 'gameplay', 'content', 'currency')),
  price_minor_units INTEGER,
  currency_code TEXT,
  local_prices TEXT NOT NULL DEFAULT '[]',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (game_id, item_name)
);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 1,
  player_id TEXT NOT NULL,
  game_account_id TEXT,
  purchase_source TEXT NOT NULL CHECK (purchase_source IN ('sale', 'grant')),
  purchase_status TEXT NOT NULL CHECK (purchase_status IN ('pending', 'completed', 'failed', 'refunded', 'charged_back')),
  price_minor_units INTEGER,
  currency_code TEXT,
  refunded_minor_units INTEGER NOT NULL DEFAULT 0,
  stripe_payment_intent_id TEXT UNIQUE,
  created_at_ms INTEGER NOT NULL,
  purchased_at_ms INTEGER,
  refunded_at_ms INTEGER
);
CREATE INDEX purchases_by_player ON purchases (game_id, player_id, purchase_status);
CREATE INDEX purchases_by_time ON purchases (game_id, created_at_ms);

-- What the game says about its sales: its refund policy (own_words with refund_policy_text in the developer's
-- words), and what it sells through its own payments (own_payment_categories, a JSON list of item categories).
ALTER TABLE games ADD COLUMN refund_policy TEXT CHECK (refund_policy IN ('no_refunds', 'unused_within_14_days', 'within_14_days', 'own_words'));
ALTER TABLE games ADD COLUMN refund_policy_text TEXT;
ALTER TABLE games ADD COLUMN own_payment_categories TEXT NOT NULL DEFAULT '[]';
