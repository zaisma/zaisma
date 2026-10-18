-- Registered links (docs/DECISIONS.md, "Games open outside links only through Zaisma"): each game's list
-- of up to 20 links, as JSON (link_name, destination_url, is_on_game_page, and each site's last check and
-- any review_reason), and when its links were last checked against Cloudflare's malware and phishing list,
-- so the check every few minutes takes the games waiting longest first.
ALTER TABLE games ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
ALTER TABLE games ADD COLUMN links_checked_at_ms INTEGER;
CREATE INDEX games_links_checked ON games (links_checked_at_ms) WHERE links != '[]';
