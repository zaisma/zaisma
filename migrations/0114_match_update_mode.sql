-- When running matches get a new version: at their next match (as before), or now. A version keeps the
-- choice its publish-later or publish-when-approved was made with; the game keeps its live version's,
-- with when it went live, so rooms that wake later still move to it.
ALTER TABLE versions ADD COLUMN match_update_mode TEXT NOT NULL DEFAULT 'next_match';
ALTER TABLE games ADD COLUMN live_version_match_update_mode TEXT NOT NULL DEFAULT 'next_match';
ALTER TABLE games ADD COLUMN live_version_published_at_ms INTEGER;
-- Whether the live version changed the game's own files (not only its game server), so a room switching to
-- it now reloads its players' games rather than only reconnecting them.
ALTER TABLE games ADD COLUMN has_live_version_game_file_changes INTEGER NOT NULL DEFAULT 1;
