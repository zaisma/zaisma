-- The Zaisma buy sheet: a developer's own Stripe account connected for sales (Connect Standard, direct charges, no
-- platform fee), a player's one saved card and optional purchase PIN, and what a sale keeps about how it was paid.
-- Adds only; nothing is rebuilt or deleted.

-- A developer's connected Stripe account. owners.stripe_customer_id (hosting billing) is a different thing: the
-- developer as Zaisma's own customer for credit.
ALTER TABLE owners ADD COLUMN stripe_account_id TEXT;
ALTER TABLE owners ADD COLUMN can_take_stripe_payments INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN stripe_country_code TEXT;
ALTER TABLE owners ADD COLUMN stripe_default_currency_code TEXT;
ALTER TABLE owners ADD COLUMN stripe_business_name TEXT;
ALTER TABLE owners ADD COLUMN stripe_support_email TEXT;
ALTER TABLE owners ADD COLUMN is_stripe_tax_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN stripe_connected_at_ms INTEGER;
CREATE UNIQUE INDEX owners_by_stripe_account ON owners (stripe_account_id) WHERE stripe_account_id IS NOT NULL;

-- A player as a customer of Zaisma's platform Stripe (their saved card lives there), and their purchase PIN.
ALTER TABLE accounts ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE accounts ADD COLUMN purchase_pin_hash TEXT;
ALTER TABLE accounts ADD COLUMN purchase_pin_failed_count INTEGER NOT NULL DEFAULT 0;

-- One saved card an account, on the platform; cloned onto the developer's account once per purchase.
CREATE TABLE saved_payment_methods (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  stripe_payment_method_id TEXT NOT NULL,
  card_brand TEXT NOT NULL,
  card_last_digits TEXT NOT NULL,
  receipt_email TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

-- How a sale was paid: the receipt email it went to, the connected account it was charged on, its Stripe Tax
-- calculation, and whether the EU withdrawal line was shown above Buy.
ALTER TABLE purchases ADD COLUMN receipt_email TEXT;
ALTER TABLE purchases ADD COLUMN stripe_account_id TEXT;
ALTER TABLE purchases ADD COLUMN stripe_tax_calculation_id TEXT;
ALTER TABLE purchases ADD COLUMN is_eu_withdrawal_line_shown INTEGER NOT NULL DEFAULT 0;
CREATE INDEX purchases_pending ON purchases (created_at_ms) WHERE purchase_status = 'pending';

-- One-time values for Stripe's connect redirect, bound to the owner who asked, for 10 minutes.
CREATE TABLE stripe_connect_states (
  state TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);

-- A signed-in session's last purchase confirm (passkey, purchase PIN or password): saved-card buys on that device
-- are one tap for 15 minutes after it. Its own table, since session_proofs keeps one proof a session and a purchase
-- confirm mustn't replace the proof "Confirm it's you" reads.
CREATE TABLE purchase_confirmations (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  confirmation_method TEXT NOT NULL CHECK (confirmation_method IN ('passkey', 'purchase_pin', 'password')),
  confirmed_at_ms INTEGER NOT NULL
);
CREATE INDEX purchase_confirmations_by_account ON purchase_confirmations (account_id);
