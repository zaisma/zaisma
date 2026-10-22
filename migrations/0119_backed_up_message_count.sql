-- Latest-only room messages: how many of a message type's sends went reliably to a player whose
-- connection was backed up, for get_stats' latest_only_available hint (send them with delivery
-- "latest_only" so a slow player gets only the newest). Counted per room, added up per game per day.
ALTER TABLE room_message_types ADD COLUMN backed_up_message_count INTEGER NOT NULL DEFAULT 0;
