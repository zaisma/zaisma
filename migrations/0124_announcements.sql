-- Announcements: short news Zaisma posts for players, shown as a closable banner at the top of zaisma.com's
-- home from starts_at_ms until ends_at_ms (the newest current one only). Posted and ended through the admin
-- MCP (post_announcement, end_announcement); created_by is the admin who posted it.
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  link_url TEXT,
  link_label TEXT,
  starts_at_ms INTEGER NOT NULL,
  ends_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
-- The home's lookup: those not ended yet, the newest start first.
CREATE INDEX announcements_by_ends_at ON announcements (ends_at_ms, starts_at_ms);
