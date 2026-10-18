-- Counted plays, the official numbers (docs/DECISIONS.md): a play counts once Cloudflare's invisible
-- check says a real browser pressed Play and the game has been on screen for a minute. The columns
-- from 0019 stay as every play started, shown to developers as a smaller line.
ALTER TABLE play_days ADD COLUMN counted INTEGER NOT NULL DEFAULT 0;
-- Browsers with a counted play that day, and those with their first counted play ever.
ALTER TABLE play_days ADD COLUMN counted_players INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_days ADD COLUMN counted_new INTEGER NOT NULL DEFAULT 0;
-- Time on screen in counted plays.
ALTER TABLE play_days ADD COLUMN counted_seconds INTEGER NOT NULL DEFAULT 0;

-- A checked play while it's going on: a random ID the page reports with, so time can't be claimed
-- faster than it passes and a play counts once. Nothing about the player. Deleted after a day.
CREATE TABLE play_tickets (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  day TEXT NOT NULL,
  -- This browser's first counted play of the day / ever, and the day of its first one.
  player INTEGER NOT NULL,
  new_player INTEGER NOT NULL,
  first_day TEXT,
  -- Time on screen reported so far.
  seconds INTEGER NOT NULL DEFAULT 0,
  counted_at INTEGER
);
CREATE INDEX play_tickets_issued ON play_tickets(issued_at);

-- Counted players per game per day by network (the internet provider's number, like Comcast's), to
-- spot bot networks: cloud servers don't count for the shelves, and no one network can carry a
-- game's ranking. Only totals; never an address.
CREATE TABLE play_networks (
  game_id TEXT NOT NULL,
  day TEXT NOT NULL,
  asn INTEGER NOT NULL,
  players INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, day, asn)
);

-- 1: Zaisma kept the game off Popular, Trending and New (faked plays, or while we check a spike).
ALTER TABLE games ADD COLUMN off_shelves INTEGER NOT NULL DEFAULT 0;
