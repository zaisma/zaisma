-- What's on at Zaisma: what a person adds to it. It fills itself from what's really happening (whats-on.ts); these rows are the events and
-- picks an admin adds through the admin MCP. An event is art across the top of the home; a pick puts one game among What's on's cards.
CREATE TABLE IF NOT EXISTS whats_on_entries (
  id TEXT PRIMARY KEY,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('event', 'pick')),
  game_id TEXT REFERENCES games(id) ON DELETE CASCADE,
  title TEXT,
  wide_art_key TEXT,
  narrow_art_key TEXT,
  link_url TEXT,
  link_label TEXT,
  starts_at_ms INTEGER NOT NULL,
  ends_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  CHECK ((entry_kind = 'pick' AND game_id IS NOT NULL) OR (entry_kind = 'event' AND title IS NOT NULL AND wide_art_key IS NOT NULL AND link_url IS NOT NULL))
);
-- The home's lookup: those not ended yet, the newest start first.
CREATE INDEX IF NOT EXISTS whats_on_entries_by_ends_at ON whats_on_entries (ends_at_ms, starts_at_ms);
