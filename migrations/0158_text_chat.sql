-- Text chat in rooms: a player report carries the last chat lines from the reporter's screen (null when it
-- carried none), and a game that checks chat between adults counts those checks for its hosting meter.
-- Adds only; nothing is rebuilt or deleted.

ALTER TABLE reports ADD COLUMN reported_chat_json TEXT;
ALTER TABLE room_usage ADD COLUMN adult_chat_check_count INTEGER NOT NULL DEFAULT 0;
