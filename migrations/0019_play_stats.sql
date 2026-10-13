-- Plays, counted by the game page when a player presses Play, per game per day (UTC): for developers'
-- play stats, and later the home page's popular and trending lists. Nothing about players: no ID, no
-- address, only counts. A "player" is a browser, so one person on two devices counts twice.
CREATE TABLE play_days (
  game_id TEXT NOT NULL,
  day TEXT NOT NULL,
  -- Presses of Play, and room links that start the game.
  plays INTEGER NOT NULL DEFAULT 0,
  -- Browsers playing it for the first time that day.
  players INTEGER NOT NULL DEFAULT 0,
  -- Browsers playing it for the first time ever.
  new_players INTEGER NOT NULL DEFAULT 0,
  -- Time the game was on screen.
  play_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, day)
);

-- Players coming back: of the browsers that first played the game on first_day, how many played it
-- again `after` days later (1 to 30), counted once a day each.
CREATE TABLE play_returns (
  game_id TEXT NOT NULL,
  first_day TEXT NOT NULL,
  after INTEGER NOT NULL,
  players INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, first_day, after)
);
