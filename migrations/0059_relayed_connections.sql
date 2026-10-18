-- Players never connect straight to each other: every WebRTC connection a game opens goes through
-- Cloudflare's relay (TURN), with credentials from the rooms Worker. Per game per day, as in room_usage:
-- how many credentials it was given, and the data the relay sent its players, read from Cloudflare's
-- analytics about once an hour (every 20 MB counts as a player-hour on the free tier).
ALTER TABLE room_usage ADD COLUMN relay_credential_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN relayed_size_bytes INTEGER NOT NULL DEFAULT 0;
