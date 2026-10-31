-- "Zaisma's own accounts are watched" in docs/DECISIONS.md (the ops repo): every 5 minutes the site Worker lists the
-- members, keys, apps and tokens of Zaisma's GitHub, npm, Supabase and Cloudflare accounts (account-watch.ts) and
-- alerts Julius on each one it hasn't seen. Zaisma's own accounts only: nothing about players or developers.

-- Every item the last good read listed. A new one alerts once; one no longer listed is deleted, so a re-add alerts again.
CREATE TABLE IF NOT EXISTS account_watch_items (
  service_name TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_label TEXT NOT NULL,
  first_seen_at_ms INTEGER NOT NULL,
  PRIMARY KEY (service_name, item_kind, item_id)
);

-- Each list read once at least: its first read is the baseline and alerts nothing. Kept apart from the items, so a
-- list that's empty (no invitations, no deploy keys) still alerts on its first item.
CREATE TABLE IF NOT EXISTS account_watch_kinds (
  service_name TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  first_read_at_ms INTEGER NOT NULL,
  PRIMARY KEY (service_name, item_kind)
);

-- One row while a list can't be read: Julius hears after 60 minutes, again every 24 hours, and the row goes on the next good read.
CREATE TABLE IF NOT EXISTS account_watch_failures (
  service_name TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  failing_since_ms INTEGER NOT NULL,
  last_told_at_ms INTEGER,
  PRIMARY KEY (service_name, item_kind)
);
