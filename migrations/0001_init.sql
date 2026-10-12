-- Games and their uploaded versions. A game is public only when status = 'live'
-- and it has a current (approved) version.
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'live', 'held', 'removed')),
  current_version_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  r2_prefix TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  scan_status TEXT NOT NULL CHECK (scan_status IN ('scanning', 'held', 'approved', 'rejected')),
  scan_report TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX versions_game ON versions(game_id, created_at);

-- Reports keep no reporter data: no IP, no email, no guest ID.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  created_at INTEGER NOT NULL
);
CREATE INDEX reports_open ON reports(status, created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'system',
  at INTEGER NOT NULL
);
CREATE INDEX audit_game ON audit_log(game_id, at);

-- Custom game domains (after beta). Hostname -> game.
CREATE TABLE domains (
  hostname TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id)
);

-- AI review spend, per calendar month (YYYY-MM), for the monthly cap.
CREATE TABLE ai_usage (
  month TEXT PRIMARY KEY,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  scans INTEGER NOT NULL DEFAULT 0
);
