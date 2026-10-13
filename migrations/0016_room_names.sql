-- Room names and labels (docs/DECISIONS.md): set by the game or typed by players. zaisma.com shows
-- them only after Zaisma's text filter; the game gets them as they are.
ALTER TABLE live_rooms ADD COLUMN name TEXT;
-- Labels as JSON, like {"Mode": "Classic", "Map": "Docks"}.
ALTER TABLE live_rooms ADD COLUMN labels TEXT NOT NULL DEFAULT '{}';
-- 1: a person hid the room's name and labels after a report.
ALTER TABLE live_rooms ADD COLUMN name_hidden INTEGER NOT NULL DEFAULT 0;

-- A report about a room keeps its name and labels as they were, since a room can rename itself.
ALTER TABLE reports ADD COLUMN room_name TEXT;
