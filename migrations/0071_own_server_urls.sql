-- Developers set their own servers (docs/DECISIONS.md, "Games can't load outside scripts, and connect only to
-- Zaisma rooms and their own servers"): the game's own servers take the API's name, own_server_urls, and become
-- a JSON list like game_server_allowed_hosts. Every stored line went through the old check, so each is a bare
-- origin with no quote or backslash. Rows keep the old default '', which the code reads as [].
ALTER TABLE games RENAME COLUMN connect_hosts TO own_server_urls;
UPDATE games SET own_server_urls = CASE WHEN own_server_urls = '' THEN '[]' ELSE '["' || replace(own_server_urls, char(10), '","') || '"]' END;
