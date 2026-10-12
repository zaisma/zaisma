-- Accounts. Sign-in itself (the email) lives in Supabase; this is everything else.
-- We keep only the age band, never the birth date.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, -- the Supabase user ID
  name TEXT NOT NULL,
  age_band TEXT NOT NULL CHECK (age_band IN ('13-17', '18+')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Who owns games: a person today, a team later, so teams drop in without moving games.
CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'team')),
  account_id TEXT UNIQUE REFERENCES accounts(id),
  created_at INTEGER NOT NULL
);

ALTER TABLE games ADD COLUMN owner_id TEXT REFERENCES owners(id);
CREATE INDEX games_owner ON games(owner_id);
