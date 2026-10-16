-- Zaisma accounts in games (docs/DECISIONS.md, "A Zaisma account works in every game"): every account
-- has one player ID, the same in every game, in its player passes and its public profile. Guests keep
-- getting a new player ID with each pass. Not the Supabase user ID, which stays inside Zaisma.
ALTER TABLE accounts ADD COLUMN player_id TEXT;
UPDATE accounts SET player_id = 'player_' || lower(hex(randomblob(10))) WHERE player_id IS NULL;
CREATE UNIQUE INDEX accounts_player_id ON accounts(player_id);

-- A room key made for a signed-in player gives passes for their account; NULL for guests. Room keys
-- are still deleted after a day, and with the account.
ALTER TABLE room_keys ADD COLUMN account_id TEXT;
