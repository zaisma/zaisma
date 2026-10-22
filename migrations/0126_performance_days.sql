-- How games run for their players, as totals (docs/DECISIONS.md, "How a game runs for its players is the developer's,
-- as totals"): one row a day per game, version and device group (browser, system, device kind, graphics chip family),
-- with fixed-bucket histograms as JSON arrays of counts (bucket edges in packages/core/src/player-performance.ts). No
-- player IDs. games.performance_measuring_enabled is the developer's off switch. A play ticket gives its load time and
-- memory once (has_performance_loading), a crash once (has_performance_crash), and no more measured time than it has
-- been open (measured_duration_sec). Adds only.
CREATE TABLE performance_days (
  game_id TEXT NOT NULL,
  date TEXT NOT NULL,
  version_id TEXT NOT NULL,
  browser_name TEXT NOT NULL,
  os_name TEXT NOT NULL,
  device_kind TEXT NOT NULL,
  graphics_family TEXT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  loading_counts TEXT NOT NULL,
  frame_rate_seconds TEXT NOT NULL,
  long_frame_count INTEGER NOT NULL DEFAULT 0,
  measured_duration_sec INTEGER NOT NULL DEFAULT 0,
  error_stop_count INTEGER NOT NULL DEFAULT 0,
  context_lost_count INTEGER NOT NULL DEFAULT 0,
  stopped_responding_count INTEGER NOT NULL DEFAULT 0,
  memory_counts TEXT NOT NULL,
  PRIMARY KEY (game_id, date, version_id, browser_name, os_name, device_kind, graphics_family)
);
ALTER TABLE games ADD COLUMN performance_measuring_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE play_tickets ADD COLUMN has_performance_loading INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_tickets ADD COLUMN has_performance_crash INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_tickets ADD COLUMN measured_duration_sec INTEGER NOT NULL DEFAULT 0;
